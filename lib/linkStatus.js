import { getRedis } from "@/lib/redis";

// Link status (board task CMT-31, PRD FR-08 + screen 06 badges).
//
// One place that decides what a link's badge says, so the list API, the
// table and later the details page always agree:
//   "active"          the link works
//   "disabled"        the owner switched it off (isActive: false)
//   "expired_date"    expiresAt is in the past
//   "expired_clicks"  all maxClicks visits are used up
export const LINK_STATUS = {
  ACTIVE: "active",
  DISABLED: "disabled",
  EXPIRED_DATE: "expired_date",
  EXPIRED_CLICKS: "expired_clicks",
};

// `hits` = how many times the redirect counted this link in Redis
// (`link:hits:{code}`, see lib/linkCache.js). The redirect lets a visit through
// while hits <= maxClicks, so once hits reaches maxClicks no visit is left.
//
// Order matters when more than one is true: the owner's own "off" switch wins,
// then the date, then the click limit.
export function getStatus(link, hits = 0, now = new Date()) {
  if (!link.isActive) return LINK_STATUS.DISABLED;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) {
    return LINK_STATUS.EXPIRED_DATE;
  }
  if (link.maxClicks != null && hits >= link.maxClicks) {
    return LINK_STATUS.EXPIRED_CLICKS;
  }
  return LINK_STATUS.ACTIVE;
}

// Reads the Redis hit counters for many links in ONE call (MGET), instead of
// one call per link. Only links with a click limit have a counter.
// Returns a Map: code → hits.
export async function getHitsForLinks(links) {
  const codes = links.filter((link) => link.maxClicks != null).map((link) => link.code);
  const hits = new Map();
  if (codes.length === 0) return hits;

  try {
    const values = await getRedis().mget(...codes.map((code) => `link:hits:${code}`));
    codes.forEach((code, i) => hits.set(code, Number(values[i] ?? 0)));
  } catch (error) {
    // Redis down: fall back to the click count saved in MongoDB. It can be a
    // little behind (clicks are saved every minute), but the list still loads.
    console.error("[linkStatus] could not read hit counters", error);
    for (const link of links) {
      if (link.maxClicks != null) hits.set(link.code, link.totalClicks ?? 0);
    }
  }
  return hits;
}
