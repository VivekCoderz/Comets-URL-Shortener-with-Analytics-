import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getHitsForLinks, getStatus, LINK_STATUS } from "@/lib/linkStatus";
import { getRedis } from "@/lib/redis";

// Tests for board task CMT-31: the link status helper.

const NOW = new Date("2026-11-13T10:00:00Z");
const base = { isActive: true, expiresAt: null, maxClicks: null };

describe("getStatus", () => {
  it("is active when nothing limits the link", () => {
    expect(getStatus(base, 0, NOW)).toBe(LINK_STATUS.ACTIVE);
  });

  it("is disabled when the owner switched it off", () => {
    expect(getStatus({ ...base, isActive: false }, 0, NOW)).toBe(LINK_STATUS.DISABLED);
  });

  it("is expired_date once expiresAt has passed", () => {
    const past = { ...base, expiresAt: new Date("2026-11-13T09:59:59Z") };
    const exact = { ...base, expiresAt: NOW };
    const future = { ...base, expiresAt: new Date("2026-11-14T00:00:00Z") };
    expect(getStatus(past, 0, NOW)).toBe(LINK_STATUS.EXPIRED_DATE);
    expect(getStatus(exact, 0, NOW)).toBe(LINK_STATUS.EXPIRED_DATE); // same rule as the redirect
    expect(getStatus(future, 0, NOW)).toBe(LINK_STATUS.ACTIVE);
  });

  it("is expired_clicks once all maxClicks visits are used", () => {
    const link = { ...base, maxClicks: 10 };
    expect(getStatus(link, 9, NOW)).toBe(LINK_STATUS.ACTIVE);
    expect(getStatus(link, 10, NOW)).toBe(LINK_STATUS.EXPIRED_CLICKS);
    expect(getStatus(link, 25, NOW)).toBe(LINK_STATUS.EXPIRED_CLICKS); // blocked tries also count
  });

  it("puts disabled first, then date, then clicks", () => {
    const everything = { isActive: false, expiresAt: new Date("2026-01-01"), maxClicks: 1 };
    expect(getStatus(everything, 5, NOW)).toBe(LINK_STATUS.DISABLED);
    expect(getStatus({ ...everything, isActive: true }, 5, NOW)).toBe(LINK_STATUS.EXPIRED_DATE);
  });

  it("accepts expiresAt as a string (cached links store ISO strings)", () => {
    expect(getStatus({ ...base, expiresAt: "2026-11-12T00:00:00.000Z" }, 0, NOW)).toBe(
      LINK_STATUS.EXPIRED_DATE,
    );
  });
});

describe("getHitsForLinks (real Redis, test-only keys)", () => {
  const codeA = `test-${randomUUID().slice(0, 8)}`;
  const codeB = `test-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await getRedis().del(`link:hits:${codeA}`, `link:hits:${codeB}`);
  });

  it("reads the counters of links that have a click limit", async () => {
    await getRedis().set(`link:hits:${codeA}`, 7);
    const hits = await getHitsForLinks([
      { code: codeA, maxClicks: 10 },
      { code: codeB, maxClicks: 5 }, // no counter yet → 0
      { code: "no-limit", maxClicks: null }, // skipped
    ]);
    expect(hits.get(codeA)).toBe(7);
    expect(hits.get(codeB)).toBe(0);
    expect(hits.has("no-limit")).toBe(false);
  });

  it("does not call Redis when no link has a limit", async () => {
    const hits = await getHitsForLinks([{ code: "x", maxClicks: null }]);
    expect(hits.size).toBe(0);
  });
});
