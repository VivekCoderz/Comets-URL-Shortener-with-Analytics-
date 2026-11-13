import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  connection: vi.fn(),
  getCachedLink: vi.fn(),
  incrementLinkHits: vi.fn(),
  cacheMissingLink: vi.fn(),
  cacheRedirectLink: vi.fn(),
  connectDB: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: mocks.after, connection: mocks.connection };
});

vi.mock("@/lib/db", () => ({ connectDB: mocks.connectDB }));
vi.mock("@/lib/linkCache", () => ({
  MISSING_LINK: "__none__",
  cacheMissingLink: mocks.cacheMissingLink,
  cacheRedirectLink: mocks.cacheRedirectLink,
  getCachedLink: mocks.getCachedLink,
  incrementLinkHits: mocks.incrementLinkHits,
}));

const { GET } = await import("@/app/[code]/route");

function request(accept) {
  return new Request("http://localhost:3000/short-code", {
    headers: accept ? { accept } : undefined,
  });
}

function context() {
  return { params: Promise.resolve({ code: "short-code" }) };
}

describe("GET /[code]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.connection.mockResolvedValue(undefined);
    mocks.getCachedLink.mockResolvedValue({
      id: "link-id",
      userId: null,
      url: "https://example.com/destination",
      active: true,
      expiresAt: null,
      maxClicks: null,
      hasPassword: false,
    });
  });

  it("returns a 410 JSON error to API clients when the link is expired", async () => {
    mocks.getCachedLink.mockResolvedValueOnce({
      id: "link-id",
      userId: null,
      url: "https://example.com/destination",
      active: true,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      maxClicks: null,
      hasPassword: false,
    });

    const response = await GET(request("application/json"), context());

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: { code: "LINK_EXPIRED", message: "This link has expired." },
    });
  });

  it("redirects browser requests for expired links to the expired page", async () => {
    mocks.getCachedLink.mockResolvedValueOnce({
      id: "link-id",
      userId: null,
      url: "https://example.com/destination",
      active: true,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      maxClicks: null,
      hasPassword: false,
    });

    const response = await GET(request("text/html"), context());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/expired");
  });

  it("returns a 410 JSON error when the atomic click count exceeds the limit", async () => {
    mocks.getCachedLink.mockResolvedValueOnce({
      id: "link-id",
      userId: null,
      url: "https://example.com/destination",
      active: true,
      expiresAt: null,
      maxClicks: 10,
      hasPassword: false,
    });
    mocks.incrementLinkHits.mockResolvedValueOnce(11);

    const response = await GET(request("application/json"), context());

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: { code: "LINK_EXPIRED", message: "This link has expired." },
    });
  });

  it("allows exactly maxClicks redirects across concurrent requests", async () => {
    let hits = 0;
    mocks.getCachedLink.mockResolvedValue({
      id: "link-id",
      userId: null,
      url: "https://example.com/destination",
      active: true,
      expiresAt: null,
      maxClicks: 10,
      hasPassword: false,
    });
    mocks.incrementLinkHits.mockImplementation(async () => ++hits);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => GET(request(), context())),
    );
    const destinationRedirects = responses.filter(
      (response) => response.headers.get("location") === "https://example.com/destination",
    );
    const expiredPageRedirects = responses.filter(
      (response) => response.headers.get("location") === "http://localhost:3000/expired",
    );

    expect(mocks.incrementLinkHits).toHaveBeenCalledTimes(20);
    expect(destinationRedirects).toHaveLength(10);
    expect(expiredPageRedirects).toHaveLength(10);
  });
});
