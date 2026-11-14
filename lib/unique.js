import { getRedis } from "@/lib/redis";

// Unique clicks per link per Indian day (board task CMT-27, PRD rule 7.7).
//
// "Unique clicks" = how many DIFFERENT people opened a link on a day.
// Each click already has a visitorHash (CMT-24): the same person on the same
// day always gets the same hash. So for every link and day we keep a Redis
// SET of the hashes we have seen. A set never stores the same value twice:
//   SADD returns 1 → this hash is new today  → count +1 unique click
//   SADD returns 0 → already seen today       → not a new unique click
//
// Who calls this: the daily stats step in the click flush (Tripti, CMT-26),
// once per non-bot click, together with `day = istDay(clickedAt)`.

// We only need today's set (and yesterday's for clicks that arrive late),
// so each set deletes itself after 2 days. This keeps the free Redis small.
export const SET_TTL_SECONDS = 2 * 24 * 60 * 60;

export function uniqueSetKey(linkId, day, prefix = "") {
  return `${prefix}uniq:${linkId}:${day}`;
}

// Returns true the first time this visitor opens this link on this day.
// `prefix` is only for tests, so they never touch real keys.
export async function markUniqueVisitor(linkId, visitorHash, day, { prefix = "" } = {}) {
  const redis = getRedis();
  const key = uniqueSetKey(String(linkId), day, prefix);

  const added = await redis.sadd(key, visitorHash);
  if (added === 1) {
    // Set (or renew) the expiry only when something was added: one extra
    // command for new visitors, none for repeat visits.
    await redis.expire(key, SET_TTL_SECONDS);
  }
  return added === 1;
}
