import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { ClickModel } from "@/models/Click";
import { LinkModel } from "@/models/Link";

// Click tracking without slowing down the redirect (PRD section 4.2, figure 3).
//
//   redirect ──after()──► pushClickEvent() ──► Redis list "clicks:queue"
//   every minute (cron) or after a redirect ──► flushClicks()
//       1. take the lock "lock:flush" (only one flush at a time)
//       2. move up to 500 events: clicks:queue ──LMOVE──► clicks:processing
//       3. turn each event into a Click document (enrich)
//       4. insertMany into MongoDB
//       5. only if MongoDB said OK: clear clicks:processing
//
// If the flush crashes between 2 and 5, the events wait in clicks:processing
// and the next flush tries them again. eventId is unique in MongoDB, so a
// retried event can never be counted twice.

// How many events one flush moves (PRD 4.2).
export const BATCH_SIZE = 500;
// The lock expires by itself after 10 s, so a crashed flush can't block forever.
const LOCK_SECONDS = 10;

// Redis key names. `prefix` is only used by the tests, so they never touch the
// real queue that everybody's dev server shares.
function keys(prefix = "") {
  return {
    queue: `${prefix}clicks:queue`,
    processing: `${prefix}clicks:processing`,
    lock: `${prefix}lock:flush`,
  };
}

// Called by the redirect inside after() (Aayush, CMT-25) with
// { eventId, linkId, time, ip, ua, referrer, country, source }.
// One Redis command, so it is fast.
export async function pushClickEvent(event, { prefix } = {}) {
  await getRedis().lpush(keys(prefix).queue, JSON.stringify(event));
}

// Moves one batch of click events from Redis into MongoDB.
//
// `enrich(event)` turns a raw event into the Click fields that need work:
// visitorHash, device, browser, os, referrer domain, isBot, isRefresh.
// That is Imran's lib/enrich.js (CMT-24); the cron route passes it in.
// It is called one event at a time, oldest first, because the refresh check
// ("seen this visitor before?") depends on the order.
//
// Returns what happened, so the cron route can log it (PRD section 6):
//   { skipped: true }               another flush holds the lock
//   { moved, saved, duplicates }    moved = events in this batch
export async function flushClicks({ enrich, batchSize = BATCH_SIZE, prefix } = {}) {
  if (typeof enrich !== "function") {
    throw new Error("flushClicks needs an enrich(event) function (lib/enrich.js, CMT-24)");
  }

  const redis = getRedis();
  const k = keys(prefix);

  // 1. Lock. SET NX only succeeds if the key does not exist yet.
  // The random value means we only ever delete our own lock (see `finally`).
  const lockId = randomUUID();
  const gotLock = await redis.set(k.lock, lockId, { nx: true, ex: LOCK_SECONDS });
  if (!gotLock) return { skipped: true };

  try {
    // 2. Events left in clicks:processing by a flush that failed are retried
    // first. Otherwise move a new batch from the queue.
    let batch = await redis.lrange(k.processing, 0, -1);

    if (batch.length === 0) {
      // LLEN first, so we never send 500 LMOVEs when only 3 events are waiting
      // (the free Upstash tier limits the number of commands).
      const waiting = await redis.llen(k.queue);
      if (waiting === 0) return { moved: 0, saved: 0, duplicates: 0 };

      // LPUSH adds new events on the left, so the oldest are on the right.
      // LMOVE right → left moves the oldest first. A pipeline sends all the
      // LMOVEs in one HTTP request; each one is still atomic, so an event is
      // always in exactly one of the two lists.
      const pipeline = redis.pipeline();
      for (let i = 0; i < Math.min(waiting, batchSize); i++) {
        pipeline.lmove(k.queue, k.processing, "right", "left");
      }
      batch = (await pipeline.exec()).filter((event) => event !== null);
      if (batch.length === 0) return { moved: 0, saved: 0, duplicates: 0 };
    } else {
      // LRANGE lists clicks:processing newest first; flip it to oldest first.
      batch.reverse();
    }

    // The Upstash client already turns stored JSON back into objects.
    const events = batch.map((event) => (typeof event === "string" ? JSON.parse(event) : event));

    // 3. Build the Click documents.
    await connectDB();
    const owners = await linkOwners(events);
    const docs = [];
    for (const event of events) {
      docs.push({
        ...(await enrich(event)),
        eventId: event.eventId,
        linkId: event.linkId,
        // Copy of the link owner, for fast per-user queries; null = guest link.
        userId: owners.get(String(event.linkId)) ?? null,
        clickedAt: new Date(event.time), // the time of the redirect, not of this insert
        country: event.country || "Unknown",
        source: event.source === "qr" ? "qr" : "link",
      });
    }

    // 4. Save. ordered: false = keep inserting after a failed document.
    const duplicates = await insertClicks(docs);

    // 5. MongoDB said OK, so these events are safe: clear the processing list.
    await redis.del(k.processing);
    return { moved: events.length, saved: docs.length - duplicates, duplicates };
  } finally {
    // Release the lock, but only if it is still ours (it may have expired and
    // been taken by another flush in the meantime).
    if ((await redis.get(k.lock)) === lockId) await redis.del(k.lock);
  }
}

// linkId → owner's userId, for every link in the batch, in one query.
async function linkOwners(events) {
  const ids = [...new Set(events.map((event) => String(event.linkId)))];
  const links = await LinkModel.find({ _id: { $in: ids } }, { userId: 1 }).lean();
  return new Map(links.map((link) => [String(link._id), link.userId]));
}

// insertMany that treats "this eventId is already saved" as success: that only
// happens when a batch is retried after a crash. Returns how many were duplicates.
// Any other error is thrown, so the batch stays in clicks:processing.
async function insertClicks(docs) {
  try {
    // throwOnValidationError: without it Mongoose silently drops a document that
    // fails validation (e.g. enrich forgot visitorHash), we would clear
    // clicks:processing and that click would be lost without any error.
    await ClickModel.insertMany(docs, { ordered: false, throwOnValidationError: true });
    return 0;
  } catch (error) {
    const writeErrors = error?.writeErrors ?? [];
    const onlyDuplicates =
      error?.code === 11000 ||
      (writeErrors.length > 0 && writeErrors.every((writeError) => writeError.code === 11000));
    if (!onlyDuplicates) throw error;
    return writeErrors.length || 1;
  }
}
