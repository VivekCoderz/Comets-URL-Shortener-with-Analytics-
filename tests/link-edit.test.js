import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for PATCH and DELETE /api/links/[id] (board task CMT-15).
// Same approach as tests/links.test.js: real MongoDB, fake cookie jar.

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
const { PATCH, DELETE } = await import("@/app/api/links/[id]/route");
const { GET: LIST } = await import("@/app/api/links/route");

const tag = randomUUID().slice(0, 8);
let owner, stranger;

async function makeUser(name) {
  return UserModel.create({
    email: `edit-${name}-${tag}@comets-test.dev`,
    name,
    passwordHash: "not-used-in-these-tests",
  });
}

let counter = 0;
async function makeLink(user) {
  counter += 1;
  return LinkModel.create({
    userId: user._id,
    code: `e${tag}${counter}`,
    longUrl: `https://example.com/edit/${counter}`,
    createdVia: "dashboard",
  });
}

async function loginAs(user) {
  cookieJar.set(AUTH_COOKIE, await createToken(user._id));
}

// The second argument is what Next.js passes: { params: Promise<{ id }> }.
const ctx = (id) => ({ params: Promise.resolve({ id: String(id) }) });

async function patch(id, body) {
  const req = new Request(`http://localhost:3000/api/links/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, ctx(id));
  return { res, body: await res.json() };
}

async function remove(id) {
  const res = await DELETE(new Request(`http://localhost:3000/api/links/${id}`, { method: "DELETE" }), ctx(id));
  return { res, body: await res.json() };
}

beforeAll(async () => {
  await connectDB();
  owner = await makeUser("owner");
  stranger = await makeUser("stranger");
});

beforeEach(() => cookieJar.clear());

afterAll(async () => {
  const conn = await connectDB();
  await LinkModel.deleteMany({ userId: { $in: [owner?._id, stranger?._id] } });
  await UserModel.deleteMany({ _id: { $in: [owner?._id, stranger?._id] } });
  await conn.disconnect();
});

describe("PATCH /api/links/[id]", () => {
  it("gives 401 to a guest", async () => {
    const link = await makeLink(owner);
    const { res } = await patch(link._id, { title: "x" });
    expect(res.status).toBe(401);
  });

  it("lets the owner change the destination, title and active flag", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);

    const { res, body } = await patch(link._id, {
      longUrl: "https://example.com/new-destination",
      title: "  Geeta Fest  ",
      isActive: false,
    });

    expect(res.status).toBe(200);
    expect(body.link).toMatchObject({
      longUrl: "https://example.com/new-destination",
      title: "Geeta Fest",
      isActive: false,
      code: link.code, // the code never changes
    });
    const saved = await LinkModel.findById(link._id);
    expect(saved.longUrl).toBe("https://example.com/new-destination");
  });

  it("removes the title when it is sent as an empty string", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);
    await patch(link._id, { title: "Old title" });

    const { body } = await patch(link._id, { title: "" });
    expect(body.link.title).toBeNull();
  });

  it("ignores attempts to change the code or the owner", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);

    const { res } = await patch(link._id, { title: "ok", code: "hacked", userId: String(stranger._id) });

    expect(res.status).toBe(200);
    const saved = await LinkModel.findById(link._id);
    expect(saved.code).toBe(link.code);
    expect(String(saved.userId)).toBe(String(owner._id));
  });

  it("gives 404 when another user tries to edit the link", async () => {
    const link = await makeLink(owner);
    await loginAs(stranger);

    const { res, body } = await patch(link._id, { title: "mine now" });

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect((await LinkModel.findById(link._id)).title).toBeUndefined();
  });

  it("gives 404 for an id that is not a real id", async () => {
    await loginAs(owner);
    const { res } = await patch("not-an-id", { title: "x" });
    expect(res.status).toBe(404);
  });

  it("rejects a bad URL, an empty body and a non-boolean isActive with 400", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);

    for (const body of [{ longUrl: "javascript:alert(1)" }, {}, { isActive: "yes" }]) {
      const { res, body: out } = await patch(link._id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(out.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("DELETE /api/links/[id]", () => {
  it("soft-deletes the owner's link: it stays in the database but leaves the list", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);

    const { res, body } = await remove(link._id);

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const saved = await LinkModel.findById(link._id);
    expect(saved).not.toBeNull();
    expect(saved.isDeleted).toBe(true);

    const listRes = await LIST(new Request("http://localhost:3000/api/links?limit=100"));
    const list = await listRes.json();
    expect(list.links.some((l) => l.id === String(link._id))).toBe(false);
  });

  it("gives 404 when the link is already deleted, and for another user's link", async () => {
    const link = await makeLink(owner);
    await loginAs(owner);
    await remove(link._id);
    expect((await remove(link._id)).res.status).toBe(404);

    const other = await makeLink(owner);
    await loginAs(stranger);
    expect((await remove(other._id)).res.status).toBe(404);
    expect((await LinkModel.findById(other._id)).isDeleted).toBe(false);
  });

  it("gives 401 to a guest", async () => {
    const link = await makeLink(owner);
    expect((await remove(link._id)).res.status).toBe(401);
  });
});
