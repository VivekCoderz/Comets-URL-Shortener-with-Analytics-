import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_WORDS } from "@/lib/reserved";
import { POST } from "@/app/api/links/route";

const { savedLinks } = vi.hoisted(() => ({ savedLinks: new Map() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/db", () => ({ connectDB: async () => {} }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://short.example" }),
}));
vi.mock("@/models/Link", () => ({
  LinkModel: {
    create: async (fields) => {
      if (savedLinks.has(fields.code)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        error.keyPattern = { code: 1 };
        throw error;
      }

      const link = {
        _id: `${fields.code}-${savedLinks.size}`,
        ...fields,
        isActive: true,
        expiresAt: null,
        maxClicks: null,
        totalClicks: 0,
        createdAt: new Date(),
      };
      savedLinks.set(fields.code, link);
      return link;
    },
  },
}));

function request(alias, longUrl = "https://example.com/alias-test") {
  return new Request("http://localhost:3000/api/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ alias, longUrl }),
  });
}

async function createLink(alias, longUrl) {
  const res = await POST(request(alias, longUrl));
  return { res, body: await res.json() };
}

beforeEach(() => {
  savedLinks.clear();
});

describe("custom aliases", () => {
  it("normalizes case and treats case variants as the same alias", async () => {
    const first = await createLink("Geeta-Fest", "https://example.com/geeta-fest");
    const second = await createLink("geeta-fest", "https://example.com/other");

    expect(first.res.status).toBe(201);
    expect(first.body.link).toMatchObject({
      code: "geeta-fest",
      isCustomAlias: true,
    });
    expect(second.res.status).toBe(409);
    expect(second.body.error.code).toBe("ALIAS_TAKEN");
    expect(savedLinks.size).toBe(1);
    expect(savedLinks.get("geeta-fest").longUrl).toBe("https://example.com/geeta-fest");
  });

  it.each(RESERVED_WORDS)("rejects reserved alias %s", async (alias) => {
    const { res, body } = await createLink(alias);

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_ALIAS");
  });

  it("rejects reserved aliases regardless of case", async () => {
    const { res, body } = await createLink("API");

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_ALIAS");
  });

  it("rejects aliases containing spaces", async () => {
    const { res, body } = await createLink("a b");

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_ALIAS");
  });

  it("allows exactly one of two simultaneous requests for the same alias", async () => {
    const alias = `race-${randomUUID().slice(0, 8)}`;

    const results = await Promise.all([
      createLink(alias, "https://example.com/race-one"),
      createLink(alias, "https://example.com/race-two"),
    ]);

    expect(results.map(({ res }) => res.status).sort()).toEqual([201, 409]);
    expect(results.filter(({ res }) => res.status === 201)).toHaveLength(1);
    expect(results.filter(({ res }) => res.status === 409)[0].body.error.code).toBe(
      "ALIAS_TAKEN",
    );
    expect(savedLinks.size).toBe(1);
    expect(savedLinks.has(alias)).toBe(true);
  });
});
