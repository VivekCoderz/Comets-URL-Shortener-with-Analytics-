import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for /api/keys (board task CMT-47): create, list, revoke.
// Same approach as tests/link-edit.test.js: real MongoDB, fake cookie jar.

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
const { hashApiKey, MAX_ACTIVE_KEYS } = await import("@/lib/apiKey");
const { UserModel } = await import("@/models/User");
const { ApiKeyModel } = await import("@/models/ApiKey");
const { POST, GET } = await import("@/app/api/keys/route");
const { DELETE } = await import("@/app/api/keys/[id]/route");

const tag = randomUUID().slice(0, 8);
let owner, stranger;

async function loginAs(user) {
  cookieJar.set(AUTH_COOKIE, await createToken(user._id));
}

async function createKey(body) {
  const res = await POST(
    new Request("http://localhost:3000/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: await res.json() };
}

async function listKeys() {
  const res = await GET(new Request("http://localhost:3000/api/keys"));
  return { res, body: await res.json() };
}

async function revoke(id) {
  const res = await DELETE(new Request(`http://localhost:3000/api/keys/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: String(id) }),
  });
  return { res, body: await res.json() };
}

beforeAll(async () => {
  await connectDB();
  owner = await UserModel.create({ email: `keys-owner-${tag}@comets-test.dev`, passwordHash: "x" });
  stranger = await UserModel.create({ email: `keys-stranger-${tag}@comets-test.dev`, passwordHash: "x" });
});

afterAll(async () => {
  await ApiKeyModel.deleteMany({ userId: { $in: [owner._id, stranger._id] } });
  await UserModel.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
});

describe("POST /api/keys", () => {
  it("needs login", async () => {
    cookieJar.clear();
    const { res } = await createKey({ name: "x", scopes: ["links:read"] });
    expect(res.status).toBe(401);
  });

  it("returns the full key once and stores only its hash and prefix", async () => {
    await loginAs(owner);
    const { res, body } = await createKey({ name: "Fest website", scopes: ["links:write", "links:read"] });
    expect(res.status).toBe(201);

    // sk_ + 32 characters
    expect(body.key).toMatch(/^sk_[A-Za-z0-9_-]{32}$/);
    expect(body.apiKey).toMatchObject({ name: "Fest website", keyPrefix: body.key.slice(0, 8), revokedAt: null });
    expect(body.apiKey.scopes.sort()).toEqual(["links:read", "links:write"]);
    expect(body.apiKey).not.toHaveProperty("keyHash");

    // In MongoDB: the SHA-256 hash, never the key itself.
    const saved = await ApiKeyModel.findById(body.apiKey.id).select("+keyHash").lean();
    expect(saved.keyHash).toBe(hashApiKey(body.key));
    expect(JSON.stringify(saved)).not.toContain(body.key);
  });

  it("rejects a missing name and unknown scopes", async () => {
    await loginAs(owner);
    expect((await createKey({ name: " ", scopes: ["links:read"] })).res.status).toBe(400);
    expect((await createKey({ name: "x", scopes: [] })).res.status).toBe(400);
    expect((await createKey({ name: "x", scopes: ["admin"] })).res.status).toBe(400);
  });

  it("allows at most 5 active keys, and revoking one frees a slot", async () => {
    await loginAs(stranger);
    const ids = [];
    for (let i = 0; i < MAX_ACTIVE_KEYS; i++) {
      const { res, body } = await createKey({ name: `key ${i}`, scopes: ["links:read"] });
      expect(res.status).toBe(201);
      ids.push(body.apiKey.id);
    }
    const sixth = await createKey({ name: "one too many", scopes: ["links:read"] });
    expect(sixth.res.status).toBe(409);
    expect(sixth.body.error.code).toBe("KEY_LIMIT_REACHED");

    await revoke(ids[0]);
    expect((await createKey({ name: "after revoke", scopes: ["links:read"] })).res.status).toBe(201);
  });
});

describe("GET /api/keys", () => {
  it("lists only my keys, without the full key or hash", async () => {
    await loginAs(owner);
    const { res, body } = await listKeys();
    expect(res.status).toBe(200);
    expect(body.apiKeys.length).toBeGreaterThan(0);
    for (const key of body.apiKeys) {
      expect(Object.keys(key).sort()).toEqual(
        ["createdAt", "id", "keyPrefix", "lastUsedAt", "name", "revokedAt", "scopes"].sort(),
      );
    }
    const mine = await ApiKeyModel.countDocuments({ userId: owner._id });
    expect(body.apiKeys).toHaveLength(mine);
  });

  it("needs login", async () => {
    cookieJar.clear();
    expect((await listKeys()).res.status).toBe(401);
  });
});

describe("DELETE /api/keys/[id]", () => {
  it("revokes my key and keeps the first revokedAt when revoked again", async () => {
    await loginAs(owner);
    const { body: created } = await createKey({ name: "to revoke", scopes: ["links:read"] });
    const first = await revoke(created.apiKey.id);
    expect(first.res.status).toBe(200);
    expect(first.body.apiKey.revokedAt).not.toBeNull();

    const again = await revoke(created.apiKey.id);
    expect(again.body.apiKey.revokedAt).toBe(first.body.apiKey.revokedAt);
  });

  it("is 404 for someone else's key and for a bad id", async () => {
    await loginAs(owner);
    const { body: created } = await createKey({ name: "owner's", scopes: ["links:read"] });
    await loginAs(stranger);
    expect((await revoke(created.apiKey.id)).res.status).toBe(404);
    expect((await revoke("not-an-id")).res.status).toBe(404);

    const still = await ApiKeyModel.findById(created.apiKey.id).lean();
    expect(still.revokedAt).toBeNull();
  });
});
