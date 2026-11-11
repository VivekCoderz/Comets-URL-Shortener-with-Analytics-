import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connectDB } from "@/lib/db";
import { flushClicks, pushClickEvent } from "@/lib/clicks";
import { getRedis } from "@/lib/redis";
import { ClickModel } from "@/models/Click";
import { LinkModel } from "@/models/Link";

// Tests for the click queue and flush (board task CMT-22, PRD section 4.2).
// They use the real Redis and MongoDB from .env.local, but every Redis key gets
// a "test:<random>:" prefix so the real clicks:queue is never touched, and every
// document made here is deleted at the end.

// Stand-in for Imran's lib/enrich.js (CMT-24): returns the fields enrich adds.
async function fakeEnrich(event) {
  return {
    visitorHash: `hash-${event.ip}`,
    device: "desktop",
    browser: "Chrome",
    os: "Windows",
    referrer: "",
    isBot: false,
    isRefresh: false,
  };
}

const redis = getRedis();
const eventIds = [];
const linkIds = [];
let prefix;
let k;

function newEvent(linkId = new mongoose.Types.ObjectId(), extra = {}) {
  const eventId = `test-${randomUUID()}`;
  eventIds.push(eventId);
  return {
    eventId,
    linkId: String(linkId),
    time: new Date().toISOString(),
    ip: "127.0.0.1",
    ua: "Mozilla/5.0",
    referrer: "",
    country: "IN",
    source: "link",
    ...extra,
  };
}

const savedClicks = (events) =>
  ClickModel.find({ eventId: { $in: events.map((event) => event.eventId) } }).lean();

beforeEach(() => {
  // A fresh prefix per test, so tests can't see each other's events.
  prefix = `test:${randomUUID()}:`;
  k = { queue: `${prefix}clicks:queue`, processing: `${prefix}clicks:processing`, lock: `${prefix}lock:flush` };
});

afterAll(async () => {
  await connectDB();
  await ClickModel.deleteMany({ eventId: { $in: eventIds } });
  await LinkModel.deleteMany({ _id: { $in: linkIds } });
  await mongoose.disconnect();
});

describe("pushClickEvent + flushClicks", () => {
  it("moves queued clicks into MongoDB and leaves Redis clean", async () => {
    const events = Array.from({ length: 5 }, () => newEvent());
    for (const event of events) await pushClickEvent(event, { prefix });
    expect(await redis.llen(k.queue)).toBe(5);

    const result = await flushClicks({ enrich: fakeEnrich, prefix });

    expect(result).toEqual({ moved: 5, saved: 5, duplicates: 0 });
    const clicks = await savedClicks(events);
    expect(clicks).toHaveLength(5);
    expect(clicks[0]).toMatchObject({ country: "IN", source: "link", isBot: false, visitorHash: "hash-127.0.0.1" });
    expect(await redis.llen(k.queue)).toBe(0);
    expect(await redis.llen(k.processing)).toBe(0);
    expect(await redis.get(k.lock)).toBeNull(); // lock released
  });

  it("stops when another flush holds the lock", async () => {
    await pushClickEvent(newEvent(), { prefix });
    await redis.set(k.lock, "someone-else", { ex: 10 });

    const result = await flushClicks({ enrich: fakeEnrich, prefix });

    expect(result).toEqual({ skipped: true });
    expect(await redis.llen(k.queue)).toBe(1); // nothing was moved
    expect(await redis.get(k.lock)).toBe("someone-else"); // not our lock, not deleted
    await redis.del(k.lock, k.queue);
  });

  it("moves at most one batch per flush, oldest events first", async () => {
    const events = Array.from({ length: 5 }, () => newEvent());
    for (const event of events) await pushClickEvent(event, { prefix });

    const first = await flushClicks({ enrich: fakeEnrich, batchSize: 3, prefix });
    expect(first.moved).toBe(3);
    expect(await savedClicks(events.slice(0, 3))).toHaveLength(3); // the 3 oldest
    expect(await redis.llen(k.queue)).toBe(2);

    const second = await flushClicks({ enrich: fakeEnrich, batchSize: 3, prefix });
    expect(second.moved).toBe(2);
    expect(await savedClicks(events)).toHaveLength(5);
  });

  it("keeps the batch in clicks:processing when saving fails, and retries it next time", async () => {
    const events = Array.from({ length: 3 }, () => newEvent());
    for (const event of events) await pushClickEvent(event, { prefix });

    // Something goes wrong in the middle of the flush.
    const brokenEnrich = async () => {
      throw new Error("enrich failed");
    };
    await expect(flushClicks({ enrich: brokenEnrich, prefix })).rejects.toThrow("enrich failed");

    // Nothing lost: the events wait in clicks:processing, nothing was saved yet.
    expect(await redis.llen(k.processing)).toBe(3);
    expect(await savedClicks(events)).toHaveLength(0);
    expect(await redis.get(k.lock)).toBeNull();

    // The next flush picks them up.
    const result = await flushClicks({ enrich: fakeEnrich, prefix });
    expect(result).toEqual({ moved: 3, saved: 3, duplicates: 0 });
    expect(await redis.llen(k.processing)).toBe(0);
  });

  it("never saves the same eventId twice (retried batch)", async () => {
    const event = newEvent();
    await pushClickEvent(event, { prefix });
    await pushClickEvent(event, { prefix }); // same event again, as after a crash

    const result = await flushClicks({ enrich: fakeEnrich, prefix });

    expect(result).toEqual({ moved: 2, saved: 1, duplicates: 1 });
    expect(await savedClicks([event])).toHaveLength(1);
    expect(await redis.llen(k.processing)).toBe(0);
  });

  it("does not lose clicks when enrich returns an invalid document", async () => {
    const event = newEvent();
    await pushClickEvent(event, { prefix });
    const enrichWithoutHash = async (e) => {
      const fields = await fakeEnrich(e);
      delete fields.visitorHash;
      return fields;
    };

    await expect(flushClicks({ enrich: enrichWithoutHash, prefix })).rejects.toThrow();
    expect(await redis.llen(k.processing)).toBe(1); // still waiting, not dropped
    await redis.del(k.processing);
  });

  it("copies the link owner's userId onto the click", async () => {
    await connectDB();
    const ownerId = new mongoose.Types.ObjectId();
    const link = await LinkModel.create({
      code: `t${randomUUID().slice(0, 8)}`,
      longUrl: "https://example.com/owner-test",
      userId: ownerId,
      createdVia: "dashboard",
    });
    linkIds.push(link._id);
    const event = newEvent(link._id, { source: "qr", country: "" });
    await pushClickEvent(event, { prefix });

    await flushClicks({ enrich: fakeEnrich, prefix });

    const [click] = await savedClicks([event]);
    expect(String(click.userId)).toBe(String(ownerId));
    expect(click.source).toBe("qr");
    expect(click.country).toBe("Unknown"); // no geo header, e.g. on localhost
  });

  it("does nothing when the queue is empty", async () => {
    const result = await flushClicks({ enrich: fakeEnrich, prefix });

    expect(result).toEqual({ moved: 0, saved: 0, duplicates: 0 });
    expect(await redis.get(k.lock)).toBeNull();
  });
});
