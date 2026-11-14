import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for the daily stats (lib/stats.js) and GET /api/links/[id]/analytics
// (board task CMT-26). Real MongoDB and Redis from .env.local, fake cookie jar
// (same approach as tests/link-edit.test.js). Unique-visitor Redis keys get a
// "test:<random>:" prefix, and every document made here is deleted at the end.

const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { connectDB } = await import("@/lib/db");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { flushClicks, pushClickEvent } = await import("@/lib/clicks");
const { getRedis } = await import("@/lib/redis");
const { encodeKey, decodeReferrer, lastIstDays, rollupClicks, summarizeStats } = await import("@/lib/stats");
const { istDay } = await import("@/lib/time");
const { ClickModel } = await import("@/models/Click");
const { DailyStatModel } = await import("@/models/DailyStat");
const { LinkModel } = await import("@/models/Link");
const { UserModel } = await import("@/models/User");
const { GET } = await import("@/app/api/links/[id]/analytics/route");

const tag = randomUUID().slice(0, 8);
const prefix = `test:${tag}:`;
const linkIds = [];
const eventIds = [];
let owner, stranger;

async function makeLink(user) {
  const link = await LinkModel.create({
    userId: user?._id ?? null,
    code: `a${tag}${linkIds.length}`,
    longUrl: `https://example.com/analytics/${linkIds.length}`,
    createdVia: "dashboard",
  });
  linkIds.push(link._id);
  return link;
}

// A saved click as the flush builds it (only the fields the rollup reads).
function click(linkId, extra = {}) {
  return {
    linkId,
    userId: null,
    clickedAt: new Date(),
    visitorHash: "visitor-a",
    country: "IN",
    device: "mobile",
    browser: "Chrome",
    os: "Android",
    referrer: "instagram.com",
    source: "link",
    isBot: false,
    isRefresh: false,
    ...extra,
  };
}

async function getAnalytics(id, range) {
  const query = range === undefined ? "" : `?range=${range}`;
  const res = await GET(new Request(`http://localhost:3000/api/links/${id}/analytics${query}`), {
    params: Promise.resolve({ id: String(id) }),
  });
  return { res, body: await res.json() };
}

beforeAll(async () => {
  await connectDB();
  const makeUser = (name) =>
    UserModel.create({ email: `stats-${name}-${tag}@comets-test.dev`, name, passwordHash: "not-used" });
  owner = await makeUser("owner");
  stranger = await makeUser("stranger");
});

afterAll(async () => {
  await DailyStatModel.deleteMany({ linkId: { $in: linkIds } });
  await ClickModel.deleteMany({ $or: [{ linkId: { $in: linkIds } }, { eventId: { $in: eventIds } }] });
  await LinkModel.deleteMany({ _id: { $in: linkIds } });
  await UserModel.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
  const redis = getRedis();
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await mongoose.disconnect();
});

describe("helpers", () => {
  it("stores dots as _ and turns referrers back into domains", () => {
    expect(encodeKey("instagram.com")).toBe("instagram_com");
    expect(encodeKey("$where")).toBe("_where");
    expect(encodeKey("")).toBe("Unknown");
    expect(encodeKey(null, "Direct")).toBe("Direct");
    expect(decodeReferrer("m_instagram_com")).toBe("m.instagram.com");
    expect(decodeReferrer("Direct")).toBe("Direct");
  });

  it("lists the last N Indian days, oldest first, today included", () => {
    // 2026-11-11 20:00 UTC is already 2026-11-12 01:30 in India.
    expect(lastIstDays(3, new Date("2026-11-11T20:00:00Z"))).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(lastIstDays(90)).toHaveLength(90);
  });

  it("adds days up and fills days without clicks with 0", () => {
    const days = ["2026-11-10", "2026-11-11", "2026-11-12"];
    const stats = [
      { day: "2026-11-10", clicks: 3, uniqueClicks: 2, qrClicks: 1, refreshes: 1, byReferrer: { instagram_com: 2, Direct: 1 }, byCountry: { IN: 3 } },
      { day: "2026-11-12", clicks: 2, uniqueClicks: 2, qrClicks: 0, refreshes: 0, byReferrer: { instagram_com: 2 }, byCountry: { US: 2 } },
    ];

    expect(summarizeStats(stats, days)).toEqual({
      range: 3,
      from: "2026-11-10",
      to: "2026-11-12",
      totals: { clicks: 5, uniqueClicks: 4, qrClicks: 1, refreshes: 1 },
      daily: [
        { day: "2026-11-10", clicks: 3 },
        { day: "2026-11-11", clicks: 0 },
        { day: "2026-11-12", clicks: 2 },
      ],
      breakdowns: {
        country: { IN: 3, US: 2 },
        referrer: { "instagram.com": 4, Direct: 1 },
        device: {},
        browser: {},
        os: {},
      },
    });
  });
});

describe("rollupClicks", () => {
  it("counts clicks, unique visitors, QR, refreshes and breakdowns; ignores bots", async () => {
    const link = await makeLink(owner);
    await rollupClicks(
      [
        click(link._id),
        click(link._id, { visitorHash: "visitor-a", referrer: null }), // same visitor, Direct
        click(link._id, { visitorHash: "visitor-b", source: "qr", country: "US", device: "desktop" }),
        click(link._id, { isRefresh: true }),
        click(link._id, { visitorHash: "bot", isBot: true }),
      ],
      { prefix },
    );

    const stat = await DailyStatModel.findOne({ linkId: link._id, day: istDay() }).lean();
    expect(stat).toMatchObject({
      clicks: 3,
      uniqueClicks: 2,
      qrClicks: 1,
      refreshes: 1,
      byCountry: { IN: 2, US: 1 },
      byDevice: { mobile: 2, desktop: 1 },
      byReferrer: { instagram_com: 2, Direct: 1 },
    });

    // A later flush on the same day adds to the same document; visitor-a is not new.
    await rollupClicks([click(link._id), click(link._id, { visitorHash: "visitor-c" })], { prefix });
    const after = await DailyStatModel.find({ linkId: link._id }).lean();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ clicks: 5, uniqueClicks: 3 });
  });

  it("puts a click on the Indian day it happened", async () => {
    const link = await makeLink(owner);
    await rollupClicks([click(link._id, { clickedAt: new Date("2026-11-11T19:00:00Z") })], { prefix });

    const stat = await DailyStatModel.findOne({ linkId: link._id }).lean();
    expect(stat.day).toBe("2026-11-12"); // 00:30 in India
  });
});

describe("flushClicks fills the daily stats", () => {
  it("counts a retried (duplicate) event only once", async () => {
    const link = await makeLink(owner);
    const event = {
      eventId: `test-${randomUUID()}`,
      linkId: String(link._id),
      time: new Date().toISOString(),
      ip: "127.0.0.1",
      ua: "Mozilla/5.0",
      referrer: "",
      country: "IN",
      source: "link",
    };
    eventIds.push(event.eventId);
    const enrich = async () => ({
      visitorHash: "flush-visitor",
      device: "desktop",
      browser: "Chrome",
      os: "Windows",
      referrer: "",
      isBot: false,
      isRefresh: false,
    });

    await pushClickEvent(event, { prefix });
    await pushClickEvent(event, { prefix }); // same event again, as after a crash
    const result = await flushClicks({ enrich, prefix });

    expect(result).toEqual({ moved: 2, saved: 1, duplicates: 1 });
    const stat = await DailyStatModel.findOne({ linkId: link._id }).lean();
    expect(stat).toMatchObject({ clicks: 1, uniqueClicks: 1, byReferrer: { Direct: 1 } });
    expect(String(stat.userId)).toBe(String(owner._id));
  });
});

describe("GET /api/links/[id]/analytics", () => {
  it("needs a login", async () => {
    cookieJar.clear();
    const { res, body } = await getAnalytics(new mongoose.Types.ObjectId());
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the summary for the owner, 7 days by default", async () => {
    const link = await makeLink(owner);
    await rollupClicks([click(link._id), click(link._id, { visitorHash: "visitor-z", source: "qr" })], { prefix });
    cookieJar.set(AUTH_COOKIE, await createToken(owner._id));

    const { res, body } = await getAnalytics(link._id);

    expect(res.status).toBe(200);
    expect(body.range).toBe(7);
    expect(body.daily).toHaveLength(7);
    expect(body.to).toBe(istDay());
    expect(body.daily.at(-1)).toEqual({ day: istDay(), clicks: 2 });
    expect(body.totals).toEqual({ clicks: 2, uniqueClicks: 2, qrClicks: 1, refreshes: 0 });
    expect(body.breakdowns.referrer).toEqual({ "instagram.com": 2 });
  });

  it("accepts 30 and 90, rejects anything else", async () => {
    const link = await makeLink(owner);
    cookieJar.set(AUTH_COOKIE, await createToken(owner._id));

    expect((await getAnalytics(link._id, 30)).body.daily).toHaveLength(30);
    expect((await getAnalytics(link._id, 90)).body.totals.clicks).toBe(0);
    const bad = await getAnalytics(link._id, 14);
    expect(bad.res.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("answers 404 for someone else's link, a bad id, or a deleted link", async () => {
    const link = await makeLink(owner);
    cookieJar.set(AUTH_COOKIE, await createToken(stranger._id));
    expect((await getAnalytics(link._id)).res.status).toBe(404);
    expect((await getAnalytics("abc")).res.status).toBe(404);

    await LinkModel.updateOne({ _id: link._id }, { isDeleted: true });
    cookieJar.set(AUTH_COOKIE, await createToken(owner._id));
    expect((await getAnalytics(link._id)).res.status).toBe(404);
  });
});
