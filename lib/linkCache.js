import { getRedis } from "@/lib/redis";

// Redis cache for the redirect (PRD FR-05, section 8.6).
// The redirect route (CMT-21, Aayush) reads and fills it; editing, disabling or
// deleting a link (CMT-20, Imran) clears it so the next click sees fresh data.

export const MISSING_LINK = "__none__";

const LINK_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const MISSING_LINK_CACHE_TTL_SECONDS = 60; // unknown codes are remembered for 60 s

function cacheKey(code) {
  return `link:${code}`;
}

export async function getCachedLink(code) {
  return getRedis().get(cacheKey(code));
}

export async function cacheRedirectLink(code, link) {
  return getRedis().set(cacheKey(code), link, { ex: LINK_CACHE_TTL_SECONDS });
}

export async function cacheMissingLink(code) {
  return getRedis().set(cacheKey(code), MISSING_LINK, {
    ex: MISSING_LINK_CACHE_TTL_SECONDS,
  });
}

export async function incrementLinkHits(code) {
  return getRedis().incr(`link:hits:${code}`);
}

// Deletes the cached copy of the link with this short code (CMT-20).
export async function deleteLinkCache(code) {
  await getRedis().del(cacheKey(code));
}
