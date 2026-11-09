import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for GET /api/links (board task CMT-11, PRD section 9).
// Same approach as tests/auth.test.js: call the route handler directly,
// against the real MongoDB from .env.local, and clean up at the end.

// cookies() only works inside a real Next.js request, so we fake it with a jar.
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
const { UserModel } = await import("@/models/User");
const { LinkModel } = await import("@/models/Link");
const { GET } = await import("@/app/api/links/route");

const tag = randomUUID().slice(0, 8); // makes this run's codes unique
let alice, bob;

async function makeUser(name) {
  return UserModel.create({
    email: `links-${name}-${tag}@comets-test.dev`,
    name,
    passwordHash: "not-used-in-these-tests",
  });
}

async function makeLink(owner, n, extra = {}) {
  return LinkModel.create({
    userId: owner._id,
    code: `t${tag}${owner.name[0]}${n}`.toLowerCase(),
    longUrl: `https://example.com/${owner.name}/${n}`,
    createdVia: "dashboard",
    ...extra,
  });
}

async function loginAs(user) {
  cookieJar.set(AUTH_COOKIE, await createToken(user._id));
}

async function list(query = "") {
  const res = await GET(new Request(`http://localhost:3000/api/links${query}`));
  return { res, body: await res.json() };
}

beforeAll(async () => {
  await connectDB();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
  // Alice: 3 links + 1 deleted. Bob: 1 link. Created one after another, so the
  // last one created is the newest.
  for (const n of [1, 2, 3]) await makeLink(alice, n);
  await makeLink(alice, 9, { isDeleted: true });
  await makeLink(bob, 1);
});

beforeEach(() => cookieJar.clear());

afterAll(async () => {
  const conn = await connectDB();
  await LinkModel.deleteMany({ userId: { $in: [alice?._id, bob?._id] } });
  await UserModel.deleteMany({ _id: { $in: [alice?._id, bob?._id] } });
  await conn.disconnect();
});

describe("GET /api/links", () => {
  it("gives 401 to a guest (no login cookie)", async () => {
    const { res, body } = await list();
    expect(res.status).toBe(401);
    expect(body.error).toMatchObject({ code: "UNAUTHORIZED", message: expect.any(String) });
  });

  it("returns only the user's own links, newest first, without deleted ones", async () => {
    await loginAs(alice);
    const { res, body } = await list();

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.links.map((l) => l.longUrl)).toEqual([
      "https://example.com/alice/3",
      "https://example.com/alice/2",
      "https://example.com/alice/1",
    ]);
    // Bob's link and Alice's deleted link never show up.
    expect(body.links.some((l) => l.longUrl.includes("/bob/"))).toBe(false);
    expect(body.links.some((l) => l.longUrl.endsWith("/9"))).toBe(false);
  });

  it("user B sees only user B's links", async () => {
    await loginAs(bob);
    const { body } = await list();
    expect(body.total).toBe(1);
    expect(body.links[0].longUrl).toBe("https://example.com/bob/1");
  });

  it("pages through links with ?page and ?limit", async () => {
    await loginAs(alice);
    const first = (await list("?page=1&limit=2")).body;
    const second = (await list("?page=2&limit=2")).body;

    expect(first).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(first.links).toHaveLength(2);
    expect(second.links).toHaveLength(1);
    // No link appears on both pages.
    const ids = [...first.links, ...second.links].map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("sends each link with its full short URL and no password hash", async () => {
    await loginAs(alice);
    const { body } = await list("?limit=1");
    const link = body.links[0];

    expect(link.shortUrl.endsWith(`/${link.code}`)).toBe(true);
    expect(link).not.toHaveProperty("passwordHash");
    expect(link).not.toHaveProperty("userId");
  });

  it("rejects a bad page or limit with 400", async () => {
    await loginAs(alice);
    for (const query of ["?page=0", "?page=abc", "?limit=500", "?limit=1.5"]) {
      const { res, body } = await list(query);
      expect(res.status, query).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
