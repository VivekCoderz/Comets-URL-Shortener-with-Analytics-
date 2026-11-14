import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Redis } from "@upstash/redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for board task CMT-18: redirects keep working when Redis is down (T5),
// and every redirect writes one timing log line.
// Real MongoDB and Redis from .env.local. "Redis is down" = a client with the
// right URL but a wrong token, so every Redis command really fails.

let redisIsDown = false;
vi.mock("@/lib/redis", async (importOriginal) => {
  const real = await importOriginal();
  const { getEnv } = await import("@/lib/env");
  let broken;
  return {
    ...real,
    getRedis: () => {
      if (!redisIsDown) return real.getRedis();
      broken ??= new Redis({ url: getEnv().UPSTASH_REDIS_REST_URL, token: "wrong-token" });
      return broken;
    },
  };
});

// Outside a real request, connection() and after() don't work. The click event
// is not pushed, so these tests never touch the real clicks:queue.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal()),
  connection: async () => {},
  after: () => {},
}));

const { connectDB } = await import("@/lib/db");
const { getRedis } = await import("@/lib/redis");
const { LinkModel } = await import("@/models/Link");
const { GET } = await import("@/app/[code]/route");

const tag = randomUUID().slice(0, 8);
const codes = [];

async function makeLink(extra = {}) {
  const code = `r${tag}${codes.length}`;
  codes.push(code);
  await LinkModel.create({
    code,
    longUrl: `https://example.com/redirect/${code}`,
    createdVia: "dashboard",
    ...extra,
  });
  return code;
}

function open(code) {
  return GET(new Request(`http://localhost:3000/${code}`), { params: Promise.resolve({ code }) });
}

// The "[redirect] ..." line the route logged for the last request.
function lastRedirectLog(spy) {
  return spy.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[redirect]")).at(-1);
}

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  redisIsDown = false;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await LinkModel.deleteMany({ code: { $in: codes } });
  const keys = codes.flatMap((code) => [`link:${code}`, `link:hits:${code}`]);
  if (keys.length > 0) await getRedis().del(...keys);
  await mongoose.disconnect();
});

describe("redirect with Redis working", () => {
  it("logs path, status, time and cache=miss, then cache=hit", async () => {
    const code = await makeLink();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const first = await open(code);
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`https://example.com/redirect/${code}`);
    expect(lastRedirectLog(info)).toMatch(new RegExp(`^\\[redirect\\] path=/${code} status=302 ms=\\d+ cache=miss$`));

    const second = await open(code);
    expect(second.headers.get("location")).toBe(`https://example.com/redirect/${code}`);
    expect(lastRedirectLog(info)).toMatch(/cache=hit$/);
  });
});

describe("redirect with Redis down (T5)", () => {
  it("still redirects, reading the link from MongoDB, and logs a warning", async () => {
    const code = await makeLink();
    redisIsDown = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await open(code);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://example.com/redirect/${code}`);
    expect(warn.mock.calls.some(([line]) => String(line).startsWith("[redis] get link:"))).toBe(true);
    expect(lastRedirectLog(info)).toMatch(/status=302 ms=\d+ cache=miss$/);
  });

  it("still shows the not-found page for an unknown code", async () => {
    redisIsDown = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await open(`zz${tag}nothing`);

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")).pathname).toBe("/link-not-found");
  });

  it("does not block a link with a click limit (clicks can't be counted)", async () => {
    const code = await makeLink({ maxClicks: 1 });
    redisIsDown = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await open(code);

    expect(response.headers.get("location")).toBe(`https://example.com/redirect/${code}`);
  });
});

// CMT-30 (PRD FR-08, T8): the click limit under parallel clicks.
describe("click limit (maxClicks)", () => {
  const VISITOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0";
  const BOT = "WhatsApp/2.23.20.0";

  function openAs(code, userAgent) {
    return GET(new Request(`http://localhost:3000/${code}`, { headers: { "user-agent": userAgent } }), {
      params: Promise.resolve({ code }),
    });
  }
  const isExpired = (response) => new URL(response.headers.get("location")).pathname === "/expired";

  it("lets exactly 10 of 20 parallel visitors through; bots don't use up the limit", async () => {
    const code = await makeLink({ maxClicks: 10 });
    vi.spyOn(console, "info").mockImplementation(() => {});
    await open(code); // fill the cache first, so all requests below race on the counter only
    await getRedis().del(`link:hits:${code}`); // that first visit doesn't count for this test

    const requests = [
      ...Array.from({ length: 20 }, () => openAs(code, VISITOR).then((r) => ({ who: "visitor", r }))),
      ...Array.from({ length: 5 }, () => openAs(code, BOT).then((r) => ({ who: "bot", r }))),
    ];
    const results = await Promise.all(requests);
    const visitors = results.filter((x) => x.who === "visitor").map((x) => x.r);

    expect(visitors.filter((r) => !isExpired(r))).toHaveLength(10);
    expect(visitors.filter(isExpired)).toHaveLength(10);
    expect(Number(await getRedis().get(`link:hits:${code}`))).toBe(20); // 20 visitors, 0 bots
  });

  it("redirects a bot without counting it, and blocks it once the limit is reached", async () => {
    const code = await makeLink({ maxClicks: 1 });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const bot = await openAs(code, BOT);
    expect(bot.headers.get("location")).toBe(`https://example.com/redirect/${code}`);
    expect(await getRedis().get(`link:hits:${code}`)).toBeNull(); // not counted

    expect(isExpired(await openAs(code, VISITOR))).toBe(false); // the 1 allowed click
    expect(isExpired(await openAs(code, BOT))).toBe(true); // limit reached
  });
});
