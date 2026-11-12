import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for POST /api/cron/flush-clicks (board task CMT-23).
// flushClicks itself is tested in tests/clicks.test.js (CMT-22), so here we
// replace it with a fake and only test the route: the secret check and that
// it passes an enrich function and returns the result.

const flushClicks = vi.fn(async () => ({ moved: 2, saved: 2, duplicates: 0 }));
vi.mock("@/lib/clicks", () => ({ flushClicks }));

// enrichClick is tested in tests/enrich.test.js (CMT-24); here we only check
// that the route passes the redirect's raw event to it correctly.
const enrichClick = vi.fn(async () => ({ visitorHash: "h", isBot: false, isRefresh: false }));
vi.mock("@/lib/enrich", () => ({ enrichClick }));

const SECRET = "test-cron-secret-1234567890";

async function call(authorization) {
  const { POST } = await import("@/app/api/cron/flush-clicks/route");
  const headers = authorization ? { authorization } : {};
  const res = await POST(new Request("http://localhost:3000/api/cron/flush-clicks", { method: "POST", headers }));
  return { res, body: await res.json() };
}

beforeEach(() => {
  flushClicks.mockClear();
  vi.resetModules(); // so lib/env.js re-reads process.env in each test
  process.env.CRON_SECRET = SECRET;
});

describe("POST /api/cron/flush-clicks", () => {
  it("gives 401 without the Authorization header", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(flushClicks).not.toHaveBeenCalled();
  });

  it("gives 401 with a wrong secret", async () => {
    const { res } = await call("Bearer wrong-secret-0000000000");
    expect(res.status).toBe(401);
    expect(flushClicks).not.toHaveBeenCalled();
  });

  it("gives 401 when the secret is sent without 'Bearer '", async () => {
    const { res } = await call(SECRET);
    expect(res.status).toBe(401);
  });

  it("flushes with the right secret and returns the result", async () => {
    const { res, body } = await call(`Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(body).toEqual({ moved: 2, saved: 2, duplicates: 0 });
    expect(flushClicks).toHaveBeenCalledTimes(1);
    const { enrich } = flushClicks.mock.calls[0][0];
    expect(typeof enrich).toBe("function");
  });

  it("passes each raw click event to enrichClick (CMT-24)", async () => {
    await call(`Bearer ${SECRET}`);
    const { enrich } = flushClicks.mock.calls[0][0];

    await enrich({
      linkId: "L1",
      ip: "1.2.3.4",
      ua: "Mozilla/5.0",
      referrer: "https://instagram.com/x",
      time: "2026-11-12T05:00:00.000Z",
    });

    expect(enrichClick).toHaveBeenCalledWith({
      linkId: "L1",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      referrer: "https://instagram.com/x",
      date: new Date("2026-11-12T05:00:00.000Z"),
    });
  });

  it("refuses every call with 503 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const { res, body } = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(body.error.code).toBe("NOT_CONFIGURED");
    expect(flushClicks).not.toHaveBeenCalled();
  });
});
