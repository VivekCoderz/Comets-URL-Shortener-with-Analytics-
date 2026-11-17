import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for lib/rateLimit.js and the daily limit in POST /api/links (board task CMT-43).
// Real Redis with a test-only key prefix, so real counters are never touched.
// The route test uses a random fake IP and deletes its counter afterwards.

const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const rl = await import("@/lib/rateLimit");
const { getRedis } = await import("@/lib/redis");
const { istDay } = await import("@/lib/time");
const { connectDB } = await import("@/lib/db");
const { LinkModel } = await import("@/models/Link");
const { POST } = await import("@/app/api/links/route");

const prefix = `test-${randomUUID().slice(0, 8)}:`;
const user = (n) => `user-${n}`;

afterAll(async () => {
  const redis = getRedis();
  let cursor = 0;
  const keys = [];
  do {
    const [next, found] = await redis.scan(cursor, { match: `${prefix}*`, count: 1000 });
    cursor = Number(next);
    keys.push(...found);
  } while (cursor !== 0);
  if (keys.length) await redis.del(...keys);
});

describe("takeDailyLink: logged-in users", () => {
  it("allows exactly `limit` links, and a blocked try does not count", async () => {
    for (let i = 1; i <= 3; i++) {
      const taken = await rl.takeDailyLink({ userId: user(1), limit: 3, prefix });
      expect(taken).toMatchObject({ ok: true, limit: 3, remaining: 3 - i });
    }
    const blocked = await rl.takeDailyLink({ userId: user(1), limit: 3, prefix });
    expect(blocked).toMatchObject({ ok: false, remaining: 0 });
    // The counter stays at 3, not 4.
    expect(Number(await getRedis().get(blocked.key))).toBe(3);
  });

  it("T11: 60 creates at the same moment → exactly 50 succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, () => rl.takeDailyLink({ userId: user(2), limit: 50, prefix })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect(results.filter((r) => !r.ok)).toHaveLength(10);
  });

  it("gives a link back when nothing was created", async () => {
    const taken = await rl.takeDailyLink({ userId: user(3), limit: 1, prefix });
    await rl.giveBackDailyLink(taken);
    expect((await rl.takeDailyLink({ userId: user(3), limit: 1, prefix })).ok).toBe(true);
  });

  it("resets at Indian midnight: the key is per IST day and expires by then", async () => {
    const now = new Date("2026-11-17T18:00:00Z"); // 23:30 in India
    const taken = await rl.takeDailyLink({ userId: user(4), limit: 50, prefix, now });
    expect(taken.key).toContain(istDay(now));
    expect(taken.reset - Math.floor(now.getTime() / 1000)).toBe(30 * 60);
    const ttl = await getRedis().ttl(taken.key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30 * 60);
  });

  it("builds the X-RateLimit headers", () => {
    expect(rl.rateLimitHeaders({ limit: 50, remaining: 37, reset: 1795000000 })).toEqual({
      "X-RateLimit-Limit": "50",
      "X-RateLimit-Remaining": "37",
      "X-RateLimit-Reset": "1795000000",
    });
  });
});

describe("takeDailyLink: guests", () => {
  it("allows 10 links per IP per day", async () => {
    for (let i = 0; i < rl.GUEST_DAILY_LIMIT; i++) {
      expect((await rl.takeDailyLink({ ip: "203.0.113.7", prefix })).ok).toBe(true);
    }
    expect((await rl.takeDailyLink({ ip: "203.0.113.7", prefix })).ok).toBe(false);
    expect((await rl.takeDailyLink({ ip: "203.0.113.8", prefix })).ok).toBe(true); // other IP
  });

  it("never stores the raw IP in the key", async () => {
    const taken = await rl.takeDailyLink({ ip: "203.0.113.9", prefix });
    expect(taken.key).not.toContain("203.0.113.9");
  });

  it("skips the guest limit when there is no IP (only on a laptop)", async () => {
    const taken = await rl.takeDailyLink({ ip: "unknown", prefix });
    expect(taken).toMatchObject({ ok: true, key: null });
  });
});

describe("password lockout", () => {
  const code = `pw${randomUUID().slice(0, 6)}`;

  it("T10: blocks the 6th try after 5 wrong passwords, for 10 minutes", async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await rl.recordPasswordFailure(code, "198.51.100.1", { prefix })).locked).toBe(false);
      expect((await rl.passwordLockStatus(code, "198.51.100.1", { prefix })).locked).toBe(false);
    }
    expect((await rl.recordPasswordFailure(code, "198.51.100.1", { prefix })).locked).toBe(true);

    const status = await rl.passwordLockStatus(code, "198.51.100.1", { prefix });
    expect(status.locked).toBe(true);
    expect(status.retryAfter).toBeGreaterThan(0);
    expect(status.retryAfter).toBeLessThanOrEqual(rl.PASSWORD_LOCK_SECONDS);
  });

  it("does not block another IP or another link", async () => {
    expect((await rl.passwordLockStatus(code, "198.51.100.2", { prefix })).locked).toBe(false);
    expect((await rl.passwordLockStatus(`${code}x`, "198.51.100.1", { prefix })).locked).toBe(false);
  });

  it("forgets wrong tries after the right password", async () => {
    await rl.recordPasswordFailure(code, "198.51.100.3", { prefix });
    await rl.clearPasswordFailures(code, "198.51.100.3", { prefix });
    expect((await rl.recordPasswordFailure(code, "198.51.100.3", { prefix })).triesLeft).toBe(4);
  });
});

describe("POST /api/links daily limit (guest)", () => {
  // A random documentation-range IP, so this test has its own counter.
  const ip = `192.0.2.${Math.floor(Math.random() * 250) + 1}`;
  const created = [];

  beforeAll(async () => {
    await connectDB();
    cookieJar.clear(); // guest
    await getRedis().del(`rl:guest:${rl.hashIp(ip)}:${istDay()}`);
  });

  afterAll(async () => {
    await LinkModel.deleteMany({ _id: { $in: created } });
    await getRedis().del(`rl:guest:${rl.hashIp(ip)}:${istDay()}`);
  });

  async function shorten(n) {
    const res = await POST(
      new Request("http://localhost:3000/api/links", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ longUrl: `https://example.com/rl/${n}` }),
      }),
    );
    const body = await res.json();
    if (body.link) created.push(body.link.id);
    return { res, body };
  }

  it("creates 10 links with X-RateLimit headers, then answers 429", async () => {
    for (let n = 1; n <= rl.GUEST_DAILY_LIMIT; n++) {
      const { res } = await shorten(n);
      expect(res.status).toBe(201);
      expect(res.headers.get("x-ratelimit-limit")).toBe("10");
      expect(res.headers.get("x-ratelimit-remaining")).toBe(String(10 - n));
    }
    const { res, body } = await shorten(11);
    expect(res.status).toBe(429);
    expect(body.error.code).toBe("DAILY_LIMIT_REACHED");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not use the allowance for invalid input", async () => {
    await getRedis().del(`rl:guest:${rl.hashIp(ip)}:${istDay()}`);
    const res = await POST(
      new Request("http://localhost:3000/api/links", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ longUrl: "not a url" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await getRedis().get(`rl:guest:${rl.hashIp(ip)}:${istDay()}`)).toBeNull();
  });
});
