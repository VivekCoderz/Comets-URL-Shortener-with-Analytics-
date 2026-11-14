import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { editLinkSchema, expiresAtSchema, maxClicksSchema } from "@/lib/validators";

// Link expiry rules (PRD FR-08, CMT-32). None of these tests need MongoDB.

// No login cookie = guest (same fake as tests/alias.test.js, but always empty).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

function firstMessage(schema, value) {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.error.issues[0].message;
}

describe("expiresAt", () => {
  it("accepts a future date with a timezone and turns it into a Date", () => {
    const value = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now, "…Z"
    const parsed = expiresAtSchema.parse(value);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe(value);

    expect(expiresAtSchema.parse("2099-12-01T18:00:00+05:30").toISOString()).toBe(
      "2099-12-01T12:30:00.000Z",
    );
  });

  it("gives a clear error for a past date", () => {
    expect(firstMessage(expiresAtSchema, "2020-01-01T00:00:00Z")).toBe(
      "Expiry date must be in the future",
    );
  });

  it.each(["2099-12-01T18:00:00", "2099-12-01", "next friday", 1234567890])(
    "refuses %j (no timezone or not a date)",
    (value) => {
      expect(firstMessage(expiresAtSchema, value)).toBe(
        "Expiry date must be a date and time with a timezone, e.g. 2026-12-01T18:00:00+05:30",
      );
    },
  );
});

describe("maxClicks", () => {
  it("accepts whole numbers of 1 or more", () => {
    expect(maxClicksSchema.parse(1)).toBe(1);
    expect(maxClicksSchema.parse(500)).toBe(500);
  });

  it.each([
    [0, "Click limit must be 1 or more"],
    [-5, "Click limit must be 1 or more"],
    [2.5, "Click limit must be a whole number"],
    ["10", "Click limit must be a number"],
  ])("refuses %j", (value, message) => {
    expect(firstMessage(maxClicksSchema, value)).toBe(message);
  });
});

describe("PATCH body", () => {
  it("lets null remove the expiry date and the click limit", () => {
    expect(editLinkSchema.parse({ expiresAt: null, maxClicks: null })).toEqual({
      expiresAt: null,
      maxClicks: null,
    });
  });

  it("refuses a past expiry date with the same clear error", () => {
    expect(firstMessage(editLinkSchema, { expiresAt: "2020-01-01T00:00:00Z" })).toBe(
      "Expiry date must be in the future",
    );
  });
});

describe("POST /api/links as a guest", () => {
  let POST;

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://short.example");
    ({ POST } = await import("@/app/api/links/route"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  // No cookie = guest. The route answers before it connects to MongoDB.
  it.each([
    { expiresAt: "2099-12-01T18:00:00+05:30" },
    { maxClicks: 10 },
  ])("gives 401 when a guest sends %j", async (extra) => {
    const response = await POST(
      new Request("https://short.example/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ longUrl: "https://example.com", ...extra }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Log in to set an expiry date or click limit" },
    });
  });
});
