import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for board task CMT-44 (Screen 06):
//   • "X of 50 links left today": GET /api/auth/me returns the quota, it goes
//     down after each create, and POST /api/links refuses at 0.
//   • Link password: set and remove with PATCH /api/links/[id]; only the
//     bcrypt hash is stored, only hasPassword is sent to the browser and to Redis.
//   • Removing a password makes the redirect go straight to the long URL again.
// Real MongoDB and Redis from .env.local, fake cookie jar (like tests/link-edit.test.js).

const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

// Outside a real request, connection() and after() don't work (same as tests/redirect.test.js).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal()),
  connection: async () => {},
  after: () => {},
}));

const { connectDB } = await import("@/lib/db");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { toCachedLink } = await import("@/lib/linkCache");
const { istDayStart } = await import("@/lib/time");
const { UserModel } = await import("@/models/User");
const { LinkModel } = await import("@/models/Link");
const { GET: ME } = await import("@/app/api/auth/me/route");
const { GET: LIST, POST: CREATE } = await import("@/app/api/links/route");
const { PATCH } = await import("@/app/api/links/[id]/route");
const { GET: REDIRECT } = await import("@/app/[code]/route");

const tag = randomUUID().slice(0, 8);
let user;
let counter = 0;

async function me() {
  const res = await ME();
  return res.json();
}

async function create(extra = {}) {
  counter += 1;
  const res = await CREATE(
    new Request("http://localhost:3000/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ longUrl: `https://example.com/quota/${tag}/${counter}`, ...extra }),
    }),
  );
  return { res, body: await res.json() };
}

async function patch(id, body) {
  const res = await PATCH(
    new Request(`http://localhost:3000/api/links/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { res, body: await res.json() };
}

function open(code) {
  return REDIRECT(new Request(`http://localhost:3000/${code}`), { params: Promise.resolve({ code }) });
}

beforeAll(async () => {
  await connectDB();
  // A small limit so the test can reach 0 quickly.
  user = await UserModel.create({
    email: `quota-${tag}@comets-test.dev`,
    passwordHash: "not-used-in-these-tests",
    dailyLinkLimit: 3,
  });
  cookieJar.set(AUTH_COOKIE, await createToken(user._id));
});

afterAll(async () => {
  await LinkModel.deleteMany({ userId: user._id });
  await UserModel.deleteOne({ _id: user._id });
});

describe("istDayStart", () => {
  it("is midnight in India", () => {
    // 10:00 UTC on 16 Nov = 15:30 in India, so the Indian day began at 18:30 UTC on 15 Nov.
    expect(istDayStart(new Date("2026-11-16T10:00:00Z")).toISOString()).toBe("2026-11-15T18:30:00.000Z");
    // 19:00 UTC on 15 Nov = 00:30 on 16 Nov in India: a new Indian day.
    expect(istDayStart(new Date("2026-11-15T19:00:00Z")).toISOString()).toBe("2026-11-15T18:30:00.000Z");
  });
});

describe("daily quota", () => {
  it("/api/auth/me returns the quota and it goes down after each create", async () => {
    expect((await me()).quota).toEqual({ limit: 3, used: 0, remaining: 3 });

    expect((await create()).res.status).toBe(201);
    expect((await me()).quota).toEqual({ limit: 3, used: 1, remaining: 2 });
  });

  it("counts a deleted link too (deleting does not give a link back)", async () => {
    const { body } = await create();
    await LinkModel.updateOne({ _id: body.link.id }, { isDeleted: true });
    expect((await me()).quota.remaining).toBe(1);
  });

  it("does not count links from before today (India time)", async () => {
    await LinkModel.create({
      userId: user._id,
      code: `old${tag}`,
      longUrl: "https://example.com/old",
      createdVia: "dashboard",
      createdAt: new Date(istDayStart().getTime() - 60 * 1000), // 1 minute before midnight
    });
    expect((await me()).quota.remaining).toBe(1);
  });

  it("refuses with 429 DAILY_LIMIT_REACHED at 0", async () => {
    expect((await create()).res.status).toBe(201);
    expect((await me()).quota.remaining).toBe(0);

    const { res, body } = await create();
    expect(res.status).toBe(429);
    expect(body.error.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("still offers 'use existing link' at 0, because that creates nothing", async () => {
    const [existing] = await LinkModel.find({ userId: user._id, isDeleted: false }).sort({ createdAt: -1 }).limit(1);
    const res = await CREATE(
      new Request("http://localhost:3000/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ longUrl: existing.longUrl }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
  });
});

describe("link password", () => {
  let link;

  beforeAll(async () => {
    link = await LinkModel.create({
      userId: user._id,
      code: `pw${tag}`,
      longUrl: "https://example.com/secret",
      createdVia: "dashboard",
    });
  });

  it("rejects a password shorter than 6 characters", async () => {
    const { res } = await patch(link._id, { password: "abc" });
    expect(res.status).toBe(400);
  });

  it("sets a password: stores only the bcrypt hash, sends only hasPassword", async () => {
    const { res, body } = await patch(link._id, { password: "fest-2026" });
    expect(res.status).toBe(200);
    expect(body.link.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain("passwordHash");

    const saved = await LinkModel.findById(link._id).select("+passwordHash");
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/); // a bcrypt hash
    expect(saved.passwordHash).not.toContain("fest-2026");

    // The list shows the 🔒 too, and never the hash.
    const list = await (await LIST(new Request("http://localhost:3000/api/links?limit=100"))).json();
    const row = list.links.find((item) => item.id === String(link._id));
    expect(row.hasPassword).toBe(true);
    expect(JSON.stringify(list)).not.toContain("$2");
  });

  it("the redirect sends a protected link to the password page", async () => {
    const res = await open(link.code);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/p/${link.code}`);
  });

  it("removing the password makes the link open directly again", async () => {
    const { body } = await patch(link._id, { password: null });
    expect(body.link.hasPassword).toBe(false);

    const saved = await LinkModel.findById(link._id).select("+passwordHash");
    expect(saved.passwordHash).toBeUndefined();

    const res = await open(link.code);
    expect(res.headers.get("location")).toBe("https://example.com/secret");
  });
});

describe("Redis cache", () => {
  it("stores hasPassword, never the hash, even if one is passed in", () => {
    const cached = toCachedLink({
      id: "1",
      url: "https://example.com",
      active: true,
      hasPassword: true,
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });
    expect(cached.hasPassword).toBe(true);
    expect(cached).not.toHaveProperty("passwordHash");
    expect(Object.keys(cached).sort()).toEqual(
      ["active", "expiresAt", "hasPassword", "id", "maxClicks", "url", "userId"].sort(),
    );
  });
});
