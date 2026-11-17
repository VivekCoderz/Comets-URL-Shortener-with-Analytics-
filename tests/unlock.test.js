import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for POST /api/r/[code]/unlock (board task CMT-42, PRD FR-09, test T10).
//
// What the board asks for:
//   CMT-42/45  wrong password → error and NO click recorded
//              right password → 302 to the destination and exactly ONE click
//   CMT-43     5 wrong passwords from one IP block that IP on that link for
//              10 minutes; the 6th try is refused (T10), even with the right
//              password, and another IP is not blocked.
//
// Real MongoDB and Redis from .env.local. pushClickEvent is replaced by a spy,
// so we can count clicks without touching the real click queue, and after()
// runs its task straight away (outside a request it would not run at all).

const pushClickEvent = vi.fn(async () => {});
vi.mock("@/lib/clicks", async (importOriginal) => ({
  ...(await importOriginal()),
  pushClickEvent,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal()),
  connection: async () => {},
  after: (task) => (typeof task === "function" ? task() : task),
}));

const { connectDB } = await import("@/lib/db");
const { getRedis } = await import("@/lib/redis");
const { hashIp, PASSWORD_MAX_TRIES } = await import("@/lib/rateLimit");
const { LinkModel } = await import("@/models/Link");
const { POST: UNLOCK } = await import("@/app/api/r/[code]/unlock/route");

const PASSWORD = "batch-2026";
const tag = randomUUID().slice(0, 8);
const code = `unlock-${tag}`;
const longUrl = `https://example.com/unlock-test/${tag}`;
// Each test uses its own made-up IP, so lockouts never leak between tests.
let ipCounter = 0;
const newIp = () => `203.0.113.${++ipCounter}`;
const usedIps = [];

function unlock(password, ip) {
  usedIps.push(ip);
  return UNLOCK(
    new Request(`http://localhost:3000/api/r/${code}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ password }),
    }),
    { params: Promise.resolve({ code }) },
  );
}

beforeAll(async () => {
  await connectDB();
  await LinkModel.create({
    code,
    longUrl,
    createdVia: "guest",
    passwordHash: await bcrypt.hash(PASSWORD, 10),
  });
});

beforeEach(() => {
  pushClickEvent.mockClear();
});

afterAll(async () => {
  await LinkModel.deleteOne({ code });
  // Lockout counters (lib/rateLimit.js passwordKey) and the link cache.
  const keys = usedIps.map((ip) => `pwfail:${code}:${hashIp(ip)}`);
  await getRedis().del(`link:${code}`, ...keys);
});

describe("POST /api/r/[code]/unlock", () => {
  it("wrong password → error, and no click is recorded", async () => {
    const res = await unlock("wrong-password", newIp());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PASSWORD");
    expect(pushClickEvent).not.toHaveBeenCalled();
  });

  it("right password → 302 to the destination, and exactly one click", async () => {
    const res = await unlock(PASSWORD, newIp());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(longUrl);
    expect(pushClickEvent).toHaveBeenCalledTimes(1);
    expect(pushClickEvent.mock.calls[0][0]).toMatchObject({ code });
  });

  it("empty password → 400, and no click", async () => {
    const res = await unlock("", newIp());

    expect(res.status).toBe(400);
    expect(pushClickEvent).not.toHaveBeenCalled();
  });

  it("unknown code → 404", async () => {
    const res = await UNLOCK(
      new Request(`http://localhost:3000/api/r/no-such-${tag}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": newIp() },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      { params: Promise.resolve({ code: `no-such-${tag}` }) },
    );
    expect(res.status).toBe(404);
  });

  it(`after ${PASSWORD_MAX_TRIES} wrong tries the next one is blocked, even with the right password (T10)`, async () => {
    const ip = newIp();
    for (let i = 0; i < PASSWORD_MAX_TRIES; i++) {
      const res = await unlock("wrong-password", ip);
      expect(res.status).toBe(401);
    }

    const blocked = await unlock(PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(pushClickEvent).not.toHaveBeenCalled();
  });

  it("a blocked IP doesn't block other visitors", async () => {
    const blockedIp = newIp();
    for (let i = 0; i < PASSWORD_MAX_TRIES; i++) await unlock("wrong-password", blockedIp);

    const res = await unlock(PASSWORD, newIp());
    expect(res.status).toBe(302);
  });

  it("the right password clears earlier wrong tries", async () => {
    const ip = newIp();
    for (let i = 0; i < PASSWORD_MAX_TRIES - 1; i++) await unlock("wrong-password", ip);
    expect((await unlock(PASSWORD, ip)).status).toBe(302);

    // The count started again, so one more wrong try is not a block.
    expect((await unlock("wrong-password", ip)).status).toBe(401);
  });
});
