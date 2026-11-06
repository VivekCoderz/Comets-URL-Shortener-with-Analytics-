import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

const { secret } = vi.hoisted(() => ({
  secret: "test-secret-that-is-at-least-32-characters",
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ JWT_SECRET: secret }),
}));

const { config, proxy } = await import("../proxy.js");
const key = new TextEncoder().encode(secret);

function request(cookie) {
  return new NextRequest("https://comets.test/dashboard", {
    headers: cookie ? { cookie } : undefined,
  });
}

async function createToken(subject = "user-123") {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

describe("dashboard proxy", () => {
  it("only matches dashboard pages", () => {
    expect(config.matcher).toBe("/dashboard/:path*");
  });

  it.each([undefined, "token=invalid-token"])(
    "redirects when the token is missing or invalid (%s)",
    async (cookie) => {
      const response = await proxy(request(cookie));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://comets.test/login");
    },
  );

  it("allows a valid token", async () => {
    const token = await createToken();
    const response = await proxy(request(`token=${token}`));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a validly signed token without a subject", async () => {
    const token = await createToken("");
    const response = await proxy(request(`token=${token}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://comets.test/login");
  });
});
