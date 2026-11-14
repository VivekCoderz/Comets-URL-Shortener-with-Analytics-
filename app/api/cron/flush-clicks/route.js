import { createHash, timingSafeEqual } from "node:crypto";
import { flushClicks } from "@/lib/clicks";
import { enrichClick } from "@/lib/enrich";
import { getEnv } from "@/lib/env";
import { apiError } from "@/lib/errors";

// POST /api/cron/flush-clicks  (board task CMT-23, PRD section 4.2)
//
// Vercel functions don't run all the time, so a scheduler (cron-job.org or
// Upstash QStash, team decision) calls this route every minute. Each call
// moves one batch of click events from the Redis queue into MongoDB, using
// Tripti's flushClicks() (lib/clicks.js, CMT-22).
//
// The scheduler must send:  Authorization: Bearer <CRON_SECRET>
// Without the right secret anyone could trigger flushes, so we answer 401.

// Turns one raw event from the redirect (CMT-25: ip, ua, referrer, time) into
// the Click fields: device, browser, os, referrer domain, isBot, visitorHash
// and isRefresh, using Imran's enrichClick() (lib/enrich.js, CMT-24).
// flushClicks() calls this once per event, oldest first.
function enrich(event) {
  return enrichClick({
    linkId: event.linkId,
    ip: event.ip,
    userAgent: event.ua,
    referrer: event.referrer,
    date: new Date(event.time),
  });
}

// Compares two strings in constant time, so an attacker can't guess the
// secret letter by letter from how long the comparison takes. Hashing first
// makes both sides the same length, which timingSafeEqual needs.
function sameSecret(a, b) {
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}

export async function POST(request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return apiError("NOT_CONFIGURED", "CRON_SECRET is not set on the server", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const sent = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!sent || !sameSecret(sent, secret)) {
    return apiError("UNAUTHORIZED", "Missing or wrong cron secret", 401);
  }

  const result = await flushClicks({ enrich });

  // One log line per run, so failures and batch sizes show up in Vercel logs (PRD section 6).
  console.info(`[flush-clicks] ${JSON.stringify(result)}`);
  return Response.json(result);
}
