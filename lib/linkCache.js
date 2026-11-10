import { getRedis } from "@/lib/redis";

export const MISSING_LINK = "__none__";

const LINK_CACHE_TTL_SECONDS = 60 * 60 * 24;
const MISSING_LINK_CACHE_TTL_SECONDS = 60;

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

export async function enqueueClick(event) {
  return getRedis().rpush("clicks:queue", JSON.stringify(event));
}
