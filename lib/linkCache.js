import { getRedis } from "@/lib/redis";

// Board task CMT-20: cache invalidation for the redirect cache (PRD FR-05).
//
// The redirect route keeps a copy of each link in Redis under `link:{code}`
// for 24 hours (key format from CMT-21). When a link is edited, disabled or
// deleted, that copy is out of date, so we delete it. The next click then
// misses the cache, reads the fresh link from MongoDB, and uses the new data.

// Deletes the cached copy of the link with this short code.
export async function deleteLinkCache(code) {
  await getRedis().del("link:" + code);
}
