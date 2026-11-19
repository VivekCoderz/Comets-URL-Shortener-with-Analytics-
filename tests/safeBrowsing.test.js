import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the Safe Browsing check (board task CMT-52, PRD FR-13, test T14).
// Google is faked: fetch calls to safebrowsing.googleapis.com get a pretend
// answer, every other fetch (Upstash Redis) goes through for real.
// If .env.local has a real GOOGLE_SAFE_BROWSING_API_KEY, one extra test asks
// the real Google about its official test URL.

const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

// The routes read the key from the environment, so give them a fake one.
const REAL_KEY = process.env.GOOGLE_SAFE_BROWSING_API_KEY || null;
process.env.GOOGLE_SAFE_BROWSING_API_KEY = "test-key";

const { connectDB } = await import("@/lib/db");
const { getRedis } = await import("@/lib/redis");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { checkUrlSafety, isBlockedDomain, UNSAFE_URL_MESSAGE } = await import("@/lib/safeBrowsing");
const { UserModel } = await import("@/models/User");
const { LinkModel } = await import("@/models/Link");
const { POST } = await import("@/app/api/links/route");
const { PATCH } = await import("@/app/api/links/[id]/route");

// Google's official test page: always flagged as malware (testsafebrowsing.appspot.com).
const GOOGLE_TEST_URL = "http://testsafebrowsing.appspot.com/s/malware.html";

const tag = randomUUID().slice(0, 8);
const prefix = `test-${tag}:`;
const cleanUrl = (n) => `https://example.com/safe-${tag}/${n}`;
let owner;

// ---- Fake Google -------------------------------------------------------------
const realFetch = globalThis.fetch;
let google; // "answer" (flags test URLs only), "down" (HTTP 500) or "offline" (network error)
let googleCalls; // request bodies Google received

beforeEach(() => {
  google = "answer";
  googleCalls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://safebrowsing.googleapis.com/")) return realFetch(input, init);

    googleCalls.push({ url, body: JSON.parse(init.body) });
    if (google === "offline") throw new TypeError("fetch failed");
    if (google === "down") return new Response("Service Unavailable", { status: 503 });
    const asked = googleCalls.at(-1).body.threatInfo.threatEntries[0].url;
    const flagged = asked.includes("testsafebrowsing.appspot.com/s/");
    return Response.json(flagged ? { matches: [{ threatType: "MALWARE", threat: { url: asked } }] } : {});
  });
});

afterEach(() => vi.restoreAllMocks());

// The routes use the real cache keys (no prefix), so remember every URL they
// checked and delete those keys afterwards, plus all prefixed test keys.
const routeUrls = new Set();
const cacheKeyFor = (url) => `safe:${createHash("sha256").update(url).digest("hex")}`;

beforeAll(async () => {
  await connectDB();
  owner = await UserModel.create({ email: `safe-${tag}@comets-test.dev`, passwordHash: "x" });
});

afterAll(async () => {
  await LinkModel.deleteMany({ longUrl: { $regex: tag } });
  await LinkModel.deleteMany({ userId: owner._id });
  await UserModel.deleteOne({ _id: owner._id });

  const redis = getRedis();
  const keys = [...routeUrls].map(cacheKeyFor);
  let cursor = 0;
  do {
    const [next, found] = await redis.scan(cursor, { match: `${prefix}*`, count: 1000 });
    cursor = Number(next);
    keys.push(...found);
  } while (cursor !== 0);
  if (keys.length) await redis.del(...keys);
});

// ---- lib/safeBrowsing.js ---------------------------------------------------------

describe("local blocklist (checked before Google)", () => {
  it("blocks other URL shorteners, their subdomains and our own domain", async () => {
    expect(isBlockedDomain("https://bit.ly/abc")).toBe(true);
    expect(isBlockedDomain("https://www.bit.ly/abc")).toBe(true);
    expect(isBlockedDomain("https://BIT.LY./abc")).toBe(true);
    expect(isBlockedDomain("https://tinyurl.com/x")).toBe(true);
    expect(isBlockedDomain(`https://sub.${new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").hostname}/x`)).toBe(true);

    expect(await checkUrlSafety("https://bit.ly/abc", { prefix })).toBe("unsafe");
    expect(googleCalls).toHaveLength(0); // Google was never asked
  });

  it("does not block look-alike domains", () => {
    expect(isBlockedDomain("https://notbit.ly/abc")).toBe(false);
    expect(isBlockedDomain("https://example.com/bit.ly")).toBe(false);
  });
});

describe("checkUrlSafety with Google", () => {
  it("flagged URL → unsafe, then served from the 6-hour cache", async () => {
    expect(await checkUrlSafety(GOOGLE_TEST_URL, { prefix })).toBe("unsafe");
    expect(await checkUrlSafety(GOOGLE_TEST_URL, { prefix })).toBe("unsafe");
    expect(googleCalls).toHaveLength(1);

    const key = `${prefix}${cacheKeyFor(GOOGLE_TEST_URL)}`;
    const ttl = await getRedis().ttl(key);
    expect(ttl).toBeGreaterThan(6 * 60 * 60 - 60);
    expect(ttl).toBeLessThanOrEqual(6 * 60 * 60);
  });

  it("clean URL → safe and cached; sends the key and the URL to Google", async () => {
    expect(await checkUrlSafety(cleanUrl(1), { prefix })).toBe("safe");
    expect(await checkUrlSafety(cleanUrl(1), { prefix })).toBe("safe");
    expect(googleCalls).toHaveLength(1);
    expect(googleCalls[0].url).toContain("v4/threatMatches:find?key=test-key");
    expect(googleCalls[0].body.threatInfo.threatEntries).toEqual([{ url: cleanUrl(1) }]);
  });

  it("Google down → unchecked, and not cached (asked again next time)", async () => {
    google = "down";
    expect(await checkUrlSafety(cleanUrl(2), { prefix })).toBe("unchecked");
    google = "offline";
    expect(await checkUrlSafety(cleanUrl(2), { prefix })).toBe("unchecked");
    expect(googleCalls).toHaveLength(2);

    google = "answer";
    expect(await checkUrlSafety(cleanUrl(2), { prefix })).toBe("safe");
  });

  it("no API key → unchecked without asking Google", async () => {
    expect(await checkUrlSafety(cleanUrl(3), { apiKey: "", prefix })).toBe("unchecked");
    expect(googleCalls).toHaveLength(0);
  });
});

// ---- Routes ------------------------------------------------------------------

async function create(longUrl) {
  routeUrls.add(longUrl);
  const res = await POST(
    new Request("http://localhost:3000/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ longUrl }),
    }),
  );
  return { res, body: await res.json() };
}

async function edit(id, longUrl) {
  routeUrls.add(longUrl);
  const res = await PATCH(
    new Request(`http://localhost:3000/api/links/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ longUrl }),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { res, body: await res.json() };
}

describe("POST /api/links", () => {
  beforeEach(() => cookieJar.clear()); // guest: no daily-limit counter without an IP

  it("T14: Google's test URL is rejected with 422 and nothing is saved", async () => {
    const before = await LinkModel.countDocuments({ longUrl: GOOGLE_TEST_URL });
    const { res, body } = await create(GOOGLE_TEST_URL);
    expect(res.status).toBe(422);
    expect(body.error).toEqual({ code: "UNSAFE_URL", message: UNSAFE_URL_MESSAGE });
    expect(await LinkModel.countDocuments({ longUrl: GOOGLE_TEST_URL })).toBe(before);
  });

  it("a link to another shortener is rejected with 422", async () => {
    const { res } = await create(`https://bit.ly/${tag}`);
    expect(res.status).toBe(422);
  });

  it("a clean URL is saved as safe", async () => {
    const { res, body } = await create(cleanUrl(10));
    expect(res.status).toBe(201);
    const saved = await LinkModel.findById(body.link.id).lean();
    expect(saved.safetyStatus).toBe("safe");
    expect(saved.safetyCheckedAt).toBeInstanceOf(Date);
  });

  it("Google down → the link is still created, as unchecked", async () => {
    google = "down";
    const { res, body } = await create(cleanUrl(11));
    expect(res.status).toBe(201);
    const saved = await LinkModel.findById(body.link.id).lean();
    expect(saved.safetyStatus).toBe("unchecked");
    expect(saved.safetyCheckedAt ?? null).toBeNull();
  });
});

describe("PATCH /api/links/[id]", () => {
  it("a flagged new destination → 422 and the link is unchanged", async () => {
    cookieJar.set(AUTH_COOKIE, await createToken(owner._id));
    const link = await LinkModel.create({
      userId: owner._id,
      code: `s${tag}`,
      longUrl: cleanUrl(20),
      createdVia: "dashboard",
      safetyStatus: "safe",
    });

    const flagged = await edit(link._id, GOOGLE_TEST_URL);
    expect(flagged.res.status).toBe(422);
    expect(flagged.body.error.code).toBe("UNSAFE_URL");
    expect((await LinkModel.findById(link._id).lean()).longUrl).toBe(cleanUrl(20));

    google = "down";
    const unchecked = await edit(link._id, cleanUrl(21));
    expect(unchecked.res.status).toBe(200);
    expect((await LinkModel.findById(link._id).lean()).safetyStatus).toBe("unchecked");

    google = "answer";
    const ok = await edit(link._id, cleanUrl(22));
    expect(ok.res.status).toBe(200);
    const saved = await LinkModel.findById(link._id).lean();
    expect(saved).toMatchObject({ longUrl: cleanUrl(22), safetyStatus: "safe" });
  });
});

// ---- Real Google (only with a real key in .env.local) ------------------------------

describe.skipIf(!REAL_KEY)("real Google Safe Browsing", () => {
  it("T14: flags Google's own test URL", async () => {
    vi.restoreAllMocks(); // real fetch, real Google
    expect(await checkUrlSafety(GOOGLE_TEST_URL, { apiKey: REAL_KEY, prefix })).toBe("unsafe");
  });
});
