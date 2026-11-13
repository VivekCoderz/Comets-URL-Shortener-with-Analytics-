import { getRedis } from "@/lib/redis";

// Redis cache for the redirect (PRD FR-05, section 8.6).
// The redirect route (CMT-21, Aayush) reads and fills it; editing, disabling or
// deleting a link (CMT-20, Imran) clears it so the next click sees fresh data.
//
// Redis is only a cache; MongoDB is the source of truth (CMT-18, PRD FR-05).
// So the functions the redirect uses never throw when Redis is down or
// misconfigured: they log a warning and behave like a cache miss, and the
// redirect reads the link from MongoDB instead (a bit slower, but it works).

export const MISSING_LINK = "__none__";

const LINK_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const MISSING_LINK_CACHE_TTL_SECONDS = 60; // unknown codes are remembered for 60 s

function cacheKey(code) {
  return `link:${code}`;
}

// Runs one Redis command. If Redis fails, logs a warning and returns
// `fallback` instead of throwing, so the redirect keeps working.
async function safely(what, command, fallback = null) {
  try {
    return await command(getRedis());
  } catch (error) {
    console.warn(`[redis] ${what} failed, using MongoDB instead: ${error?.message ?? error}`);
    return fallback;
  }
}

// The cached link, MISSING_LINK, or null (not cached, or Redis is down).
export async function getCachedLink(code) {
  return safely(`get ${cacheKey(code)}`, (redis) => redis.get(cacheKey(code)));
}

// If saving to the cache fails, the link is simply read from MongoDB next time.
export async function cacheRedirectLink(code, link) {
  return safely(`set ${cacheKey(code)}`, (redis) =>
    redis.set(cacheKey(code), link, { ex: LINK_CACHE_TTL_SECONDS }),
  );
}

export async function cacheMissingLink(code) {
  return safely(`set ${cacheKey(code)}`, (redis) =>
    redis.set(cacheKey(code), MISSING_LINK, { ex: MISSING_LINK_CACHE_TTL_SECONDS }),
  );
}

// Click count for the max-clicks limit. Returns null when Redis is down: then
// we can't count, so the redirect lets the click through rather than block a
// working link.
export async function incrementLinkHits(code) {
  return safely(`incr link:hits:${code}`, (redis) => redis.incr(`link:hits:${code}`));
}

// Deletes the cached copy of the link with this short code (CMT-20).
// This one still throws: if an edit can't clear the cache, the edit should
// fail loudly instead of the old URL staying cached for 24 hours.
export async function deleteLinkCache(code) {
  await getRedis().del(cacheKey(code));
}
