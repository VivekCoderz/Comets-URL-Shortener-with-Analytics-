import { describe, expect, it, vi } from "vitest";

// Fake salt so tests don't need .env.local.
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ VISITOR_HASH_SALT: "test-salt-that-is-at-least-32-characters" }),
}));

// In-memory stand-in for Upstash Redis. Only supports what enrich uses: set with nx.
const { store } = vi.hoisted(() => ({ store: new Map() }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (key, value, { nx } = {}) => {
      if (nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
  }),
}));

const {
  enrichClick,
  isBotUserAgent,
  istDate,
  makeVisitorHash,
  parseUserAgent,
  referrerDomain,
} = await import("@/lib/enrich");

const WHATSAPP_UA = "WhatsApp/2.23.20.0 A";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("bot detection", () => {
  it("marks a WhatsApp preview as a bot (T9)", () => {
    expect(isBotUserAgent(WHATSAPP_UA)).toBe(true);
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Twitterbot/1.0",
    "curl/8.4.0",
    "",
  ])("marks %j as a bot", (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it("does not mark normal browsers as bots", () => {
    expect(isBotUserAgent(IPHONE_UA)).toBe(false);
    expect(isBotUserAgent(WINDOWS_CHROME_UA)).toBe(false);
  });
});

describe("user-agent parsing", () => {
  it("reads an iPhone", () => {
    expect(parseUserAgent(IPHONE_UA)).toEqual({
      device: "mobile",
      browser: "Mobile Safari",
      os: "iOS",
    });
  });

  it("treats a desktop browser as desktop", () => {
    expect(parseUserAgent(WINDOWS_CHROME_UA)).toEqual({
      device: "desktop",
      browser: "Chrome",
      os: "Windows",
    });
  });
});

describe("referrer", () => {
  it("keeps only the domain", () => {
    expect(referrerDomain("https://www.instagram.com/p/abc?x=1")).toBe("instagram.com");
  });

  it("returns null for no referrer or a bad one", () => {
    expect(referrerDomain(undefined)).toBe(null);
    expect(referrerDomain("not a url")).toBe(null);
  });
});

describe("visitor hash", () => {
  it("uses the India date, not the UTC date", () => {
    // 20:00 UTC on 1 Jan = 01:30 IST on 2 Jan.
    expect(istDate(new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-02");
  });

  it("is the same on the same IST day and different on the next", () => {
    const visitor = { ip: "1.2.3.4", userAgent: IPHONE_UA };
    const morning = makeVisitorHash({ ...visitor, date: new Date("2026-01-01T03:00:00Z") });
    const evening = makeVisitorHash({ ...visitor, date: new Date("2026-01-01T15:00:00Z") });
    const nextDay = makeVisitorHash({ ...visitor, date: new Date("2026-01-01T19:00:00Z") });

    expect(morning).toMatch(/^[0-9a-f]{64}$/);
    expect(evening).toBe(morning);
    expect(nextDay).not.toBe(morning);
  });
});

describe("enrichClick", () => {
  const click = {
    linkId: "link-1",
    ip: "1.2.3.4",
    userAgent: IPHONE_UA,
    referrer: "https://t.co/xyz",
  };

  it("marks the second open by the same visitor as a refresh (T17)", async () => {
    store.clear();
    const first = await enrichClick(click);
    const second = await enrichClick(click);

    expect(first).toMatchObject({
      device: "mobile",
      browser: "Mobile Safari",
      os: "iOS",
      referrer: "t.co",
      isBot: false,
      isRefresh: false,
    });
    expect(second.isRefresh).toBe(true);
    expect(second.visitorHash).toBe(first.visitorHash);
  });

  it("does not mark a different link or a different visitor as a refresh", async () => {
    store.clear();
    await enrichClick(click);

    expect((await enrichClick({ ...click, linkId: "link-2" })).isRefresh).toBe(false);
    expect((await enrichClick({ ...click, ip: "5.6.7.8" })).isRefresh).toBe(false);
  });
});
