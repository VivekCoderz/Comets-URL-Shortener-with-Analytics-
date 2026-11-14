import { getRedis } from "@/lib/redis";
import { istDay } from "@/lib/time";
import { SET_TTL_SECONDS, uniqueSetKey } from "@/lib/unique";
import { DailyStatModel } from "@/models/DailyStat";

// Daily stats for the analytics pages (board task CMT-26, PRD section 8.5).
//
// Writing: the click flush (lib/clicks.js) calls rollupClicks() with the clicks
// it just saved. We add them to one DailyStat document per link per Indian day
// with $inc, so the analytics API never has to scan the raw clicks.
//
// Reading: GET /api/links/[id]/analytics calls summarizeStats() to add up the
// DailyStat documents of the chosen range (7, 30 or 90 days).

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Name used for clicks without a referrer. MongoDB can't $inc a field with an
// empty name ("byReferrer."), so "" can't be used as the key.
export const DIRECT = "Direct";

// MongoDB keys cannot contain "." or start with "$", so "instagram.com" is
// stored as "instagram_com". Empty values get a fallback name instead.
export function encodeKey(value, fallback = "Unknown") {
  const key = String(value ?? "").trim() || fallback;
  return key.replaceAll(".", "_").replace(/^\$/, "_");
}

// Turns a stored referrer key back into a domain: "instagram_com" → "instagram.com".
// Safe because domain names never contain "_".
export function decodeReferrer(key) {
  return key === DIRECT ? DIRECT : key.replaceAll("_", ".");
}

// inc["byCountry.IN"] += 1 (starts at 0 the first time).
function addOne(inc, field) {
  inc[field] = (inc[field] ?? 0) + 1;
}

// Adds freshly saved clicks to the DailyStat documents.
// `clicks` = the Click documents the flush just inserted (never retried
// duplicates, so a click is never counted twice).
//   bots      → not counted at all (PRD 7.7)
//   refreshes → only `refreshes` goes up
//   others    → clicks, qrClicks, breakdowns, and uniqueClicks for a new visitor
// `prefix` is only for tests (Redis keys of the unique-visitor sets).
export async function rollupClicks(clicks, { prefix } = {}) {
  // One $inc object per link per day, so the whole batch is one bulkWrite.
  const groups = new Map();
  const counted = []; // non-bot, non-refresh clicks, for the unique check

  for (const click of clicks) {
    if (click.isBot) continue;

    const day = istDay(new Date(click.clickedAt));
    const groupKey = `${click.linkId}|${day}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { linkId: click.linkId, userId: click.userId ?? null, day, inc: {} });
    }
    const inc = groups.get(groupKey).inc;

    // A refresh is the same visitor within 30 minutes on the same day, so it
    // can never be a new unique visitor: no Redis call needed for it.
    if (click.isRefresh) {
      addOne(inc, "refreshes");
      continue;
    }

    counted.push({ click, day, inc });
    addOne(inc, "clicks");
    if (click.source === "qr") addOne(inc, "qrClicks");

    addOne(inc, `byCountry.${encodeKey(click.country)}`);
    addOne(inc, `byDevice.${encodeKey(click.device)}`);
    addOne(inc, `byBrowser.${encodeKey(click.browser)}`);
    addOne(inc, `byOs.${encodeKey(click.os)}`);
    addOne(inc, `byReferrer.${encodeKey(click.referrer, DIRECT)}`);
  }

  if (groups.size === 0) return 0;

  // Unique visitors, the same way as Vivek's markUniqueVisitor() (lib/unique.js):
  // SADD the visitorHash into the link's set for that day; 1 = new visitor.
  // Here all the SADDs go in ONE pipeline (one HTTP request): calling Redis
  // 500 times one by one could take longer than the 10 s flush lock.
  if (counted.length > 0) {
    const redis = getRedis();
    const setKeys = counted.map(({ click, day }) => uniqueSetKey(String(click.linkId), day, prefix));

    const adds = redis.pipeline();
    counted.forEach(({ click }, i) => adds.sadd(setKeys[i], click.visitorHash));
    const results = await adds.exec();

    const newKeys = new Set();
    counted.forEach(({ inc }, i) => {
      if (results[i] === 1) {
        addOne(inc, "uniqueClicks");
        newKeys.add(setKeys[i]);
      }
    });

    // Each set deletes itself 2 days after its last new visitor (as in lib/unique.js).
    if (newKeys.size > 0) {
      const expiries = redis.pipeline();
      for (const key of newKeys) expiries.expire(key, SET_TTL_SECONDS);
      await expiries.exec();
    }
  }

  // upsert: the first click of a day creates that day's document.
  await DailyStatModel.bulkWrite(
    [...groups.values()].map(({ linkId, userId, day, inc }) => ({
      updateOne: {
        filter: { linkId, day },
        update: { $inc: inc, $setOnInsert: { userId } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return groups.size;
}

// The last `range` Indian days, oldest first, ending today.
// lastIstDays(3, 2026-11-12) → ["2026-11-10", "2026-11-11", "2026-11-12"]
export function lastIstDays(range, now = new Date()) {
  return Array.from({ length: range }, (_, i) => istDay(new Date(now.getTime() - (range - 1 - i) * ONE_DAY_MS)));
}

// Adds a breakdown map ({ IN: 4 }) of one day into the running total.
function addInto(total, map, decode = (key) => key) {
  for (const [key, count] of Object.entries(map ?? {})) {
    const name = decode(key);
    total[name] = (total[name] ?? 0) + count;
  }
}

// Adds up DailyStat documents (from .lean()) into the analytics API response.
// `days` = every day of the range, so days without clicks get 0 (no chart gaps).
export function summarizeStats(stats, days) {
  const totals = { clicks: 0, uniqueClicks: 0, qrClicks: 0, refreshes: 0 };
  const breakdowns = { country: {}, referrer: {}, device: {}, browser: {}, os: {} };
  const clicksByDay = new Map(days.map((day) => [day, 0]));

  for (const stat of stats) {
    for (const field of Object.keys(totals)) totals[field] += stat[field] ?? 0;
    if (clicksByDay.has(stat.day)) clicksByDay.set(stat.day, clicksByDay.get(stat.day) + (stat.clicks ?? 0));

    addInto(breakdowns.country, stat.byCountry);
    addInto(breakdowns.referrer, stat.byReferrer, decodeReferrer);
    addInto(breakdowns.device, stat.byDevice);
    addInto(breakdowns.browser, stat.byBrowser);
    addInto(breakdowns.os, stat.byOs);
  }

  return {
    range: days.length,
    from: days[0],
    to: days[days.length - 1],
    totals,
    daily: [...clicksByDay].map(([day, clicks]) => ({ day, clicks })),
    breakdowns,
  };
}
