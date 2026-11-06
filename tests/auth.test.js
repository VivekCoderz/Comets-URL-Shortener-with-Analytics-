import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the auth route handlers (PRD FR-02, Day 2 · lane D).
// We call the route handlers directly with a Request, the same way Next.js does,
// against the real MongoDB database from .env.local. Every test user gets a
// unique email and is deleted at the end.

// --- Fake Next.js request helpers -------------------------------------------
// cookies() from next/headers only works inside a real Next.js request.
// In tests we replace it with a small in-memory cookie jar.
const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, ...cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, c]) => ({ name, ...c })),
    has: (name) => cookieJar.has(name),
    set: (nameOrCookie, value, options = {}) => {
      const c = typeof nameOrCookie === "object" ? nameOrCookie : { name: nameOrCookie, value, ...options };
      cookieJar.set(c.name, c);
    },
    delete: (name) => cookieJar.delete(typeof name === "object" ? name.name : name),
  }),
  headers: async () => new Headers(),
}));
// connection() and after() also need a real request; in tests they do nothing special.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal()),
  connection: async () => {},
  after: (task) => (typeof task === "function" ? task() : task),
}));

// --- Helpers ----------------------------------------------------------------
const SIGNUP_ROUTE = "app/api/auth/signup/route.js";
const LOGIN_ROUTE = "app/api/auth/login/route.js";
// Vivek's routes (CMT-7) may not be merged yet. Until they are, these tests are skipped.
const routesReady = existsSync(SIGNUP_ROUTE) && existsSync(LOGIN_ROUTE);

function jsonRequest(path, body) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

async function signup(body) {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(jsonRequest("/api/auth/signup", body));
  return { res, body: await res.json() };
}

async function login(body) {
  const { POST } = await import("@/app/api/auth/login/route");
  const res = await POST(jsonRequest("/api/auth/login", body));
  return { res, body: await res.json() };
}

// The login cookie can be set with cookies() (our jar) or on the response itself.
function tokenCookie(res) {
  if (cookieJar.size > 0) return [...cookieJar.values()][0];
  const header = res.headers.get("set-cookie");
  if (!header) return undefined;
  return { value: header.split(";")[0].split("=")[1], httpOnly: /httponly/i.test(header) };
}

const testEmails = [];
function newTestUser() {
  const email = `test-${randomUUID()}@comets-test.dev`;
  testEmails.push(email);
  return { email, password: "correct-horse-42", name: "Test User" };
}

// --- Tests ------------------------------------------------------------------
describe.skipIf(!routesReady)("auth routes", () => {
  beforeEach(() => cookieJar.clear());

  afterAll(async () => {
    const { connectDB } = await import("@/lib/db");
    const conn = await connectDB();
    await conn.connection.collection("users").deleteMany({ email: { $in: testEmails } });
    await conn.disconnect();
  });

  describe("POST /api/auth/signup", () => {
    it("creates a user and returns only { user }", async () => {
      const user = newTestUser();
      const { res, body } = await signup(user);

      expect(res.status).toBe(201);
      expect(body.user.email).toBe(user.email);
      // The password hash and the token must never be sent back (PRD FR-02).
      expect(body.user).not.toHaveProperty("passwordHash");
      expect(body).not.toHaveProperty("token");
    });

    it("gives 409 for an email that is already registered", async () => {
      const user = newTestUser();
      expect((await signup(user)).res.status).toBe(201);

      const { res, body } = await signup(user);

      expect(res.status).toBe(409);
      expect(body.error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    });

    it("compares emails in lower case (Test@X.com = test@x.com)", async () => {
      const user = newTestUser();
      expect((await signup(user)).res.status).toBe(201);

      const { res } = await signup({ ...user, email: `  ${user.email.toUpperCase()}  ` });

      expect(res.status).toBe(409);
    });

    it("rejects a password shorter than 8 characters with 400", async () => {
      const { res, body } = await signup({ ...newTestUser(), password: "short" });

      expect(res.status).toBe(400);
      expect(body.error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    });
  });

  describe("POST /api/auth/login", () => {
    it("gives 401 and 'Invalid email or password' for a wrong password", async () => {
      const user = newTestUser();
      expect((await signup(user)).res.status).toBe(201);
      cookieJar.clear();

      const { res, body } = await login({ email: user.email, password: "wrong-password-1" });

      expect(res.status).toBe(401);
      expect(body.error.message).toBe("Invalid email or password");
      expect(tokenCookie(res)).toBeUndefined(); // no login cookie on failure
    });

    it("gives the same 401 message for an email that does not exist", async () => {
      const { res, body } = await login({
        email: `nobody-${randomUUID()}@comets-test.dev`,
        password: "whatever-123",
      });

      expect(res.status).toBe(401);
      expect(body.error.message).toBe("Invalid email or password");
    });

    it("logs in with the right password and sets an httpOnly cookie", async () => {
      const user = newTestUser();
      expect((await signup(user)).res.status).toBe(201);
      cookieJar.clear();

      const { res, body } = await login({ email: user.email, password: user.password });

      expect(res.status).toBe(200);
      expect(body.user.email).toBe(user.email);
      expect(body).not.toHaveProperty("token"); // the JWT lives only in the cookie
      const cookie = tokenCookie(res);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.httpOnly).toBe(true);
    });
  });
});
