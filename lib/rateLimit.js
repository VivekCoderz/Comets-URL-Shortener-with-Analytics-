import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { istDay, secondsUntilIstMidnight } from "@/lib/time";

// Rate limits (board task CMT-43, PRD FR-11 and FR-09).
//
//   1. Daily link limit: logged-in users 50 links per Indian day
//      (user.dailyLinkLimit), guests 10 per IP per day (team decision, 17 Nov).
//   2. Password lockout: 5 wrong passwords for one link from one IP
//      → that IP is blocked on that link for 10 minutes.
//
// Both use Redis INCR. INCR adds 1 and returns the new number in ONE step, so
// two requests arriving at the same moment can never get the same number.
// That is why 60 parallel creates give exactly 50 successes (PRD test T11).
//
// `prefix` is only for tests, so they never touch real keys.

export const GUEST_DAILY_LIMIT = 10; // team decision (17 Nov)
export const PASSWORD_MAX_TRIES = 5;
export const PASSWORD_LOCK_SECONDS = 10 * 60;

// ---- IP address --------------------------------------------------------------

// On Vercel the visitor's real IP is the first value of x-forwarded-for.
export function clientIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// The raw IP is never stored, not even in Redis: only a salted hash (privacy).
export function hashIp(ip) {
  return createHash("sha256").update(`${ip}|${getEnv().VISITOR_HASH_SALT}`).digest("hex");
}

// ---- 1. Daily link limit -------------------------------------------------------

// Takes one link from today's allowance.
//   who: { userId, limit } for a logged-in user, or { ip } for a guest.
// Returns { ok, key, limit, remaining, reset }:
//   ok        false = limit reached (nothing was used up)
//   remaining links left today after this one
//   reset     Unix time (seconds) of the next Indian midnight
export async function takeDailyLink({ userId, limit, ip, now = new Date(), prefix = "" }) {
  const day = istDay(now);
  const max = userId ? limit : GUEST_DAILY_LIMIT;
  const secondsLeft = secondsUntilIstMidnight(now);
  const reset = Math.floor(now.getTime() / 1000) + secondsLeft;

  // A guest with no IP only happens on a laptop (npm run dev, tests): Vercel
  // always sets x-forwarded-for and a visitor can't remove it. Without this,
  // every teammate's local guest links would share ONE counter in our shared
  // Redis and block everyone after 10. So: no IP → no guest limit.
  if (!userId && (!ip || ip === "unknown")) {
    return { ok: true, key: null, limit: max, remaining: max, reset };
  }

  const key = userId
    ? `${prefix}rl:create:${userId}:${day}`
    : `${prefix}rl:guest:${hashIp(ip)}:${day}`;

  const redis = getRedis();
  const count = await redis.incr(key);
  // First link of the day: the counter deletes itself at Indian midnight.
  if (count === 1) await redis.expire(key, secondsLeft);

  if (count > max) {
    // Over the limit: undo our +1 so the counter stays at the real number.
    await redis.decr(key);
    return { ok: false, key, limit: max, remaining: 0, reset };
  }
  return { ok: true, key, limit: max, remaining: max - count, reset };
}

// Gives the link back when nothing was created after all (alias taken,
// no free code found), so a failed create doesn't use up the allowance.
export async function giveBackDailyLink(taken) {
  if (taken?.ok && taken.key) await getRedis().decr(taken.key);
}

// Standard rate-limit headers, so API clients know where they stand.
export function rateLimitHeaders(taken) {
  return {
    "X-RateLimit-Limit": String(taken.limit),
    "X-RateLimit-Remaining": String(taken.remaining),
    "X-RateLimit-Reset": String(taken.reset),
  };
}

// ---- 2. Password lockout -------------------------------------------------------

function passwordKey(code, ip, prefix) {
  return `${prefix}pwfail:${code}:${hashIp(ip)}`;
}

// Is this IP blocked on this link right now? Check BEFORE comparing the
// password, so a blocked IP can't keep guessing.
// Returns { locked, retryAfter } (retryAfter in seconds).
export async function passwordLockStatus(code, ip, { prefix = "" } = {}) {
  const redis = getRedis();
  const key = passwordKey(code, ip, prefix);
  const count = Number((await redis.get(key)) ?? 0);
  if (count < PASSWORD_MAX_TRIES) return { locked: false, retryAfter: 0 };
  const ttl = await redis.ttl(key);
  return { locked: true, retryAfter: ttl > 0 ? ttl : PASSWORD_LOCK_SECONDS };
}

// Call after a WRONG password. The 5th wrong try starts a fresh 10-minute block.
export async function recordPasswordFailure(code, ip, { prefix = "" } = {}) {
  const redis = getRedis();
  const key = passwordKey(code, ip, prefix);
  const count = await redis.incr(key);
  if (count === 1 || count === PASSWORD_MAX_TRIES) await redis.expire(key, PASSWORD_LOCK_SECONDS);
  return {
    locked: count >= PASSWORD_MAX_TRIES,
    triesLeft: Math.max(0, PASSWORD_MAX_TRIES - count),
  };
}

// Call after the RIGHT password: forget the earlier wrong tries.
export async function clearPasswordFailures(code, ip, { prefix = "" } = {}) {
  await getRedis().del(passwordKey(code, ip, prefix));
}

// ---- 3. Per-key API limit ------------------------------------------------------

// Each API key may make 60 requests per minute (PRD FR-12, board task CMT-48).
// Same INCR idea as the daily limit, but the window is one clock minute:
//   rl:api:{keyId}:{minute}   minute = minutes since 1 Jan 1970 (UTC)
// A new minute means a new Redis key, so the count starts again from 0.
export const API_DEFAULT_PER_MINUTE = 60;

// Takes one request from this key's allowance for the current minute.
//   keyId  the ApiKey document id
//   limit  apiKey.rateLimitPerMin (60 unless changed in the database)
// Returns { ok, key, limit, remaining, reset } like takeDailyLink, so
// rateLimitHeaders() works for both.
export async function takeApiRequest({ keyId, limit = API_DEFAULT_PER_MINUTE, now = new Date(), prefix = "" }) {
  const minute = Math.floor(now.getTime() / 60_000);
  const reset = (minute + 1) * 60; // Unix time (seconds) when the next minute starts
  const key = `${prefix}rl:api:${keyId}:${minute}`;

  const redis = getRedis();
  const count = await redis.incr(key);
  // First request this minute: the counter deletes itself once the minute is over.
  if (count === 1) await redis.expire(key, 60);

  // No DECR when blocked (unlike the daily limit): this counter is thrown away
  // within a minute anyway, and every blocked try still sees "over the limit".
  if (count > limit) return { ok: false, key, limit, remaining: 0, reset };
  return { ok: true, key, limit, remaining: limit - count, reset };
}
