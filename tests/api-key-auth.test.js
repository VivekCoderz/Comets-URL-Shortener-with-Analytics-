import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for the API key check on /api/v1 requests (board task CMT-48, PRD FR-12, T12).
// Real MongoDB and Redis, like tests/api-keys.test.js and tests/rateLimit.test.js.
// Rate-limit counters use a test-only prefix and are deleted afterwards.

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
const { getRedis } = await import("@/lib/redis");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { generateApiKey, hashApiKey, KEY_PREFIX_LENGTH, requireApiKey } = await import("@/lib/apiKey");
const { takeApiRequest, API_DEFAULT_PER_MINUTE } = await import("@/lib/rateLimit");
const { UserModel } = await import("@/models/User");
const { ApiKeyModel } = await import("@/models/ApiKey");
const keysRoute = await import("@/app/api/keys/route");
const keyRoute = await import("@/app/api/keys/[id]/route");

const tag = randomUUID().slice(0, 8);
const prefix = `test-${tag}:`;
let owner;

// Saves a key straight into MongoDB (the same way POST /api/keys does) and
// returns the full key, which only the caller ever sees.
async function makeKey(scopes, extra = {}) {
  const key = generateApiKey();
  const doc = await ApiKeyModel.create({
    userId: owner._id,
    name: `test ${scopes.join(",")}`,
    scopes,
    keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
    keyHash: hashApiKey(key),
    ...extra,
  });
  return { key, doc };
}

function v1Request(key) {
  const headers = key === undefined ? {} : { authorization: key };
  return new Request("http://localhost:3000/api/v1/links", { method: "POST", headers });
}

async function check(key, scope, options = {}) {
  const result = await requireApiKey(v1Request(key), scope, { prefix, ...options });
  if (!result.error) return { status: 200, result };
  return { status: result.error.status, body: await result.error.json(), result };
}

beforeAll(async () => {
  await connectDB();
  owner = await UserModel.create({ email: `key-auth-${tag}@comets-test.dev`, passwordHash: "x" });
});

afterAll(async () => {
  await ApiKeyModel.deleteMany({ userId: owner._id });
  await UserModel.deleteMany({ _id: owner._id });

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

describe("requireApiKey: who is let in", () => {
  it("401 without a header, with a wrong format, or with an unknown key", async () => {
    expect((await check(undefined, "links:read")).status).toBe(401);
    expect((await check("sk_tooShort", "links:read")).status).toBe(401);
    expect((await check(`Basic ${generateApiKey()}`, "links:read")).status).toBe(401);

    const unknown = await check(`Bearer ${generateApiKey()}`, "links:read");
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("UNAUTHORIZED");
  });

  it("a valid key with the right scope passes, with user, headers and lastUsedAt", async () => {
    const { key, doc } = await makeKey(["links:read"]);
    const { status, result } = await check(`Bearer ${key}`, "links:read");
    expect(status).toBe(200);
    expect(String(result.apiKey._id)).toBe(String(doc._id));
    expect(String(result.user._id)).toBe(String(owner._id));
    expect(result.headers["X-RateLimit-Limit"]).toBe(String(API_DEFAULT_PER_MINUTE));
    expect(result.headers["X-RateLimit-Remaining"]).toBe(String(API_DEFAULT_PER_MINUTE - 1));

    const saved = await ApiKeyModel.findById(doc._id).lean();
    expect(saved.lastUsedAt).toBeInstanceOf(Date);
  });

  it("T12: a read-only key cannot create links (403)", async () => {
    const { key } = await makeKey(["links:read"]);
    const { status, body } = await check(`Bearer ${key}`, "links:write");
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("T12: a revoked key gives 401 immediately after revoking", async () => {
    const { key, doc } = await makeKey(["links:read", "links:write"]);
    expect((await check(`Bearer ${key}`, "links:write")).status).toBe(200);

    // Revoke through the real dashboard route (login cookie).
    cookieJar.set(AUTH_COOKIE, await createToken(owner._id));
    const res = await keyRoute.DELETE(new Request(`http://localhost:3000/api/keys/${doc._id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: String(doc._id) }),
    });
    expect(res.status).toBe(200);
    cookieJar.clear();

    expect((await check(`Bearer ${key}`, "links:write")).status).toBe(401);
  });

  it("401 when the key's owner is blocked", async () => {
    const blocked = await UserModel.create({
      email: `key-auth-blocked-${tag}@comets-test.dev`,
      passwordHash: "x",
      status: "blocked",
    });
    try {
      const key = generateApiKey();
      await ApiKeyModel.create({
        userId: blocked._id,
        name: "blocked owner",
        scopes: ["links:read"],
        keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
        keyHash: hashApiKey(key),
      });
      expect((await check(`Bearer ${key}`, "links:read")).status).toBe(401);
    } finally {
      await ApiKeyModel.deleteMany({ userId: blocked._id });
      await UserModel.deleteOne({ _id: blocked._id });
    }
  });
});

describe("per-key rate limit: 60 requests per minute", () => {
  it("takeApiRequest: 70 requests at the same moment → exactly 60 pass", async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 70 }, () => takeApiRequest({ keyId: `parallel-${tag}`, now, prefix })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(60);
    expect(results[0].key).toBe(`${prefix}rl:api:parallel-${tag}:${Math.floor(now.getTime() / 60_000)}`);
  });

  it("the next minute starts again from 0", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 60_000);
    for (let i = 0; i < 3; i++) await takeApiRequest({ keyId: `minute-${tag}`, limit: 3, now, prefix });
    expect((await takeApiRequest({ keyId: `minute-${tag}`, limit: 3, now, prefix })).ok).toBe(false);
    expect((await takeApiRequest({ keyId: `minute-${tag}`, limit: 3, now: later, prefix })).ok).toBe(true);
  });

  it("requireApiKey answers 429 with Retry-After once the key is over its limit", async () => {
    const { key } = await makeKey(["links:read"], { rateLimitPerMin: 2 });
    const now = new Date();
    expect((await check(`Bearer ${key}`, "links:read", { now })).status).toBe(200);
    expect((await check(`Bearer ${key}`, "links:read", { now })).status).toBe(200);

    const third = await check(`Bearer ${key}`, "links:read", { now });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(third.result.error.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(third.result.error.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("API keys cannot manage API keys", () => {
  it("POST and GET /api/keys with only a Bearer key (no login cookie) → 401", async () => {
    const { key } = await makeKey(["links:read", "links:write", "analytics:read"]);
    cookieJar.clear();
    const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

    const create = await keysRoute.POST(
      new Request("http://localhost:3000/api/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "sneaky", scopes: ["links:write"] }),
      }),
    );
    expect(create.status).toBe(401);

    const list = await keysRoute.GET(new Request("http://localhost:3000/api/keys", { headers }));
    expect(list.status).toBe(401);
  });
});
