import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for custom aliases (PRD FR-04) and the duplicate check (FR-04b),
// board task CMT-15. Route tests call POST directly against the real MongoDB
// from .env.local, like tests/links.test.js, and clean up at the end.

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

const { RESERVED_WORDS, isReserved } = await import("@/lib/reserved");
const { aliasSchema } = await import("@/lib/validators");
const { connectDB } = await import("@/lib/db");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { UserModel } = await import("@/models/User");
const { LinkModel } = await import("@/models/Link");
const { POST } = await import("@/app/api/links/route");

// Error code the route would send for this alias (null = alias is fine).
function aliasError(value) {
  const result = aliasSchema.safeParse(value);
  return result.success ? null : result.error.issues[0].params.apiCode;
}

describe("alias rules (unit)", () => {
  it("accepts valid aliases and stores them lower-cased", () => {
    expect(aliasSchema.parse("geeta-fest")).toBe("geeta-fest");
    expect(aliasSchema.parse("Geeta-Fest")).toBe("geeta-fest");
    expect(aliasSchema.parse("GEETA-FEST")).toBe("geeta-fest");
    expect(aliasSchema.parse("abc")).toBe("abc"); // 3 = shortest allowed
    expect(aliasSchema.parse("a".repeat(30))).toBe("a".repeat(30)); // 30 = longest
    expect(aliasSchema.parse("fest-2026-day-1")).toBe("fest-2026-day-1");
    expect(aliasSchema.parse("123")).toBe("123");
  });

  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(31)],
    ["empty", ""],
    ["a space", "geeta fest"],
    ["an underscore", "geeta_fest"],
    ["a double hyphen", "geeta--fest"],
    ["a leading hyphen", "-geeta"],
    ["a trailing hyphen", "geeta-"],
    ["a dot", "geeta.fest"],
    ["a slash", "geeta/fest"],
    ["Unicode letters", "gëeta"],
    ["Hindi text", "गीता"],
    ["an emoji", "fest🎉"],
    ["a Kelvin sign that lower-cases to k", "Kite"],
    ["a leading space", " geeta"],
  ])("rejects an alias with %s", (_description, value) => {
    expect(aliasError(value)).toBe("INVALID_ALIAS");
  });

  it("rejects an alias that is not text", () => {
    expect(aliasSchema.safeParse(123).success).toBe(false);
  });

  it.each(RESERVED_WORDS)("blocks the reserved word %s", (word) => {
    expect(aliasError(word)).toBe("RESERVED_ALIAS");
    expect(aliasError(word.toUpperCase())).toBe("RESERVED_ALIAS");
  });

  it("has exactly the reserved words from the PRD", () => {
    expect([...RESERVED_WORDS].sort()).toEqual(
      [
        "api", "login", "signup", "logout", "dashboard", "p", "expired", "admin",
        "health", "pricing", "_next", "static", "assets", "qr", "docs", "help",
        "settings", "favicon.ico", "robots.txt",
      ].sort(),
    );
    expect(isReserved("Login")).toBe(true);
    expect(isReserved("geeta-fest")).toBe(false);
  });
});

describe("POST /api/links with alias and forceNew", () => {
  const tag = randomUUID().slice(0, 8); // makes this run's aliases unique
  let alice, bob;

  async function makeUser(name) {
    return UserModel.create({
      email: `alias-${name}-${tag}@comets-test.dev`,
      name,
      passwordHash: "not-used-in-these-tests",
    });
  }

  async function loginAs(user) {
    cookieJar.set(AUTH_COOKIE, await createToken(user._id));
  }

  async function create(body) {
    const res = await POST(
      new Request("http://localhost:3000/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { res, body: await res.json() };
  }

  const url = (path) => `https://example.com/${tag}/${path}`;

  beforeAll(async () => {
    await connectDB();
    alice = await makeUser("alice");
    bob = await makeUser("bob");
  });

  beforeEach(() => cookieJar.clear());

  afterAll(async () => {
    const conn = await connectDB();
    await LinkModel.deleteMany({ longUrl: { $regex: `^https://example\\.com/${tag}/` } });
    await UserModel.deleteMany({ _id: { $in: [alice?._id, bob?._id] } });
    await conn.disconnect();
  });

  it("creates a link with a custom alias, stored lower-cased", async () => {
    const { res, body } = await create({ longUrl: url("fest"), alias: `Fest-${tag}` });
    expect(res.status).toBe(201);
    expect(body.link.code).toBe(`fest-${tag}`);
    expect(body.link.isCustomAlias).toBe(true);
    expect(body.link.shortUrl).toMatch(new RegExp(`/fest-${tag}$`));
  });

  it("gives 409 ALIAS_TAKEN when the alias is taken, in any case", async () => {
    const { res, body } = await create({ longUrl: url("other"), alias: `FEST-${tag}` });
    expect(res.status).toBe(409);
    expect(body.error).toMatchObject({ code: "ALIAS_TAKEN", message: expect.any(String) });
  });

  it("lets exactly one of two requests for the same alias at once win", async () => {
    const alias = `race-${tag}`;
    const results = await Promise.all([
      create({ longUrl: url("race-1"), alias }),
      create({ longUrl: url("race-2"), alias }),
    ]);
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("gives 400 RESERVED_ALIAS for /api (and /API)", async () => {
    for (const alias of ["api", "API"]) {
      const { res, body } = await create({ longUrl: url("reserved"), alias });
      expect(res.status).toBe(400);
      expect(body.error.code).toBe("RESERVED_ALIAS");
    }
  });

  it("gives 400 INVALID_ALIAS for a badly formed alias", async () => {
    const { res, body } = await create({ longUrl: url("bad"), alias: "geeta--fest" });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_ALIAS");
  });

  it("still gives 400 INVALID_URL for a bad long URL", async () => {
    const { res, body } = await create({ longUrl: "not a url", alias: `ok-${tag}` });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("gives 400 when forceNew is not true/false", async () => {
    await loginAs(alice);
    const { res, body } = await create({ longUrl: url("x"), forceNew: "yes" });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns { duplicate: true, existing } when the user shortens the same URL again", async () => {
    await loginAs(alice);
    const first = await create({ longUrl: url("dup") });
    expect(first.res.status).toBe(201);

    const again = await create({ longUrl: url("dup") });
    expect(again.res.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.existing.id).toBe(first.body.link.id);
    expect(again.body.existing.shortUrl).toBe(first.body.link.shortUrl);
    expect(again.body.link).toBeUndefined();

    // Nothing new was saved.
    expect(await LinkModel.countDocuments({ userId: alice._id, longUrl: url("dup") })).toBe(1);
  });

  it("also returns the duplicate when an alias is sent, without using the alias", async () => {
    await loginAs(alice);
    const { res, body } = await create({ longUrl: url("dup"), alias: `dup-${tag}` });
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(await LinkModel.exists({ code: `dup-${tag}` })).toBeNull();
  });

  it("creates a new link with a different code when forceNew is true", async () => {
    await loginAs(alice);
    const existing = await LinkModel.findOne({ userId: alice._id, longUrl: url("dup") });
    const { res, body } = await create({ longUrl: url("dup"), forceNew: true });
    expect(res.status).toBe(201);
    expect(body.link.code).not.toBe(existing.code);
  });

  it("does not count another user's link as a duplicate", async () => {
    await loginAs(bob);
    const { res, body } = await create({ longUrl: url("dup") });
    expect(res.status).toBe(201);
    expect(body.duplicate).toBeUndefined();
  });

  it("does not count a deleted link as a duplicate", async () => {
    await loginAs(alice);
    const first = await create({ longUrl: url("deleted") });
    await LinkModel.updateOne({ _id: first.body.link.id }, { isDeleted: true });
    const { res } = await create({ longUrl: url("deleted") });
    expect(res.status).toBe(201);
  });

  it("never runs the duplicate check for guests", async () => {
    const first = await create({ longUrl: url("guest") });
    const second = await create({ longUrl: url("guest") });
    expect(first.res.status).toBe(201);
    expect(second.res.status).toBe(201);
    expect(second.body.link.code).not.toBe(first.body.link.code);
  });
});
