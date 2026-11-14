import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { istDay, secondsUntilIstMidnight } from "@/lib/time";
import { markUniqueVisitor, uniqueSetKey } from "@/lib/unique";
import { getRedis } from "@/lib/redis";

// Tests for board task CMT-27: the IST day helper and unique clicks.

describe("istDay", () => {
  it("uses the Indian day, not the UTC day", () => {
    // 18:29:59 UTC is 23:59:59 in India: still the same day.
    expect(istDay(new Date("2026-11-11T18:29:59Z"))).toBe("2026-11-11");
    // 18:30:00 UTC is midnight in India: already the next day.
    expect(istDay(new Date("2026-11-11T18:30:00Z"))).toBe("2026-11-12");
  });

  it("handles month and year boundaries", () => {
    expect(istDay(new Date("2026-11-30T19:00:00Z"))).toBe("2026-12-01");
    expect(istDay(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
});

describe("secondsUntilIstMidnight", () => {
  it("counts the seconds left in the Indian day", () => {
    // 23:00 in India → 1 hour left.
    expect(secondsUntilIstMidnight(new Date("2026-11-11T17:30:00Z"))).toBe(3600);
    // Exactly midnight in India → a whole day left.
    expect(secondsUntilIstMidnight(new Date("2026-11-11T18:30:00Z"))).toBe(86400);
  });
});

describe("markUniqueVisitor (real Redis, test-only keys)", () => {
  const prefix = `test-${randomUUID().slice(0, 8)}:`;
  const linkId = "link-test-1";
  const day = "2026-11-12";

  afterAll(async () => {
    await getRedis().del(
      uniqueSetKey(linkId, day, prefix),
      uniqueSetKey(linkId, "2026-11-13", prefix),
      uniqueSetKey("link-test-2", day, prefix),
    );
  });

  it("is true the first time a visitor opens a link on a day", async () => {
    expect(await markUniqueVisitor(linkId, "visitor-a", day, { prefix })).toBe(true);
  });

  it("is false when the same visitor comes back the same day", async () => {
    expect(await markUniqueVisitor(linkId, "visitor-a", day, { prefix })).toBe(false);
  });

  it("is true for a different visitor", async () => {
    expect(await markUniqueVisitor(linkId, "visitor-b", day, { prefix })).toBe(true);
  });

  it("is true again on the next day and on another link", async () => {
    expect(await markUniqueVisitor(linkId, "visitor-a", "2026-11-13", { prefix })).toBe(true);
    expect(await markUniqueVisitor("link-test-2", "visitor-a", day, { prefix })).toBe(true);
  });

  it("makes the set expire within 2 days", async () => {
    const ttl = await getRedis().ttl(uniqueSetKey(linkId, day, prefix));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2 * 24 * 60 * 60);
  });
});
