import { createHash } from "node:crypto";
import { UAParser } from "ua-parser-js";
import { getEnv } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { istDay } from "@/lib/time";

// Turns a raw redirect into analytics facts (CMT-24, PRD rule 7.7):
// device / browser / OS, referrer domain, bot or not, visitor hash, refresh or not.

// Same visitor opening the same link again within this time = refresh (team decision: 30 min).
export const REFRESH_WINDOW_SECONDS = 30 * 60;

// User-agents of link-preview bots, crawlers and command-line tools.
// The last part ("bot|crawler|spider") catches most other well-behaved bots.
const BOT_PATTERN =
  /whatsapp|facebookexternalhit|slackbot|twitterbot|telegrambot|linkedinbot|discordbot|googlebot|bingbot|curl|wget|python-requests|bot|crawler|spider/i;

// The Click model only allows these device values (models/Click.js).
const KNOWN_DEVICES = ["mobile", "tablet"];

export function isBotUserAgent(userAgent) {
  // No user-agent at all is almost never a real browser.
  if (!userAgent) return true;
  return BOT_PATTERN.test(userAgent);
}

export function parseUserAgent(userAgent) {
  const result = new UAParser(userAgent || "").getResult();
  const type = result.device.type;

  let device;
  if (!type) device = "desktop"; // ua-parser leaves type empty for desktops
  else if (KNOWN_DEVICES.includes(type)) device = type;
  else device = "other"; // smarttv, console, wearable, xr, embedded…

  return {
    device,
    browser: result.browser.name || null,
    os: result.os.name || null,
  };
}

// Keeps only the domain of the referrer, e.g. "https://www.instagram.com/p/x" → "instagram.com".
// The full URL is not stored (privacy). null = no referrer = "Direct".
export function referrerDomain(referrer) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null; // not a valid URL
  }
}

// Date in India time (UTC+5:30) as "YYYY-MM-DD".
// Uses the shared helper in lib/time.js (CMT-27), so every part of the app
// agrees on what "today" is.
export function istDate(date = new Date()) {
  return istDay(date);
}

// SHA-256(IP + user-agent + salt + IST date). The raw IP is never stored.
// The date is part of the hash, so the same person gets a new hash every IST day
// (this is what makes a "unique click" per day, PRD 7.7).
// "|" separates the parts so "1.2.3.4" + "5x" can't collide with "1.2.3.45" + "x".
export function makeVisitorHash({ ip, userAgent, date = new Date() }) {
  const { VISITOR_HASH_SALT } = getEnv();
  return createHash("sha256")
    .update([ip || "", userAgent || "", VISITOR_HASH_SALT, istDate(date)].join("|"))
    .digest("hex");
}

// SET with nx only succeeds if the key does not exist yet.
// First open → key is created → "OK" → not a refresh.
// Open again within the window → key exists → null → refresh.
export async function checkRefresh(linkId, visitorHash) {
  const result = await getRedis().set(`seen:${linkId}:${visitorHash}`, 1, {
    nx: true,
    ex: REFRESH_WINDOW_SECONDS,
  });
  return result === null;
}

// Main entry point, called once per redirect.
export async function enrichClick({ linkId, ip, userAgent, referrer, date = new Date() }) {
  const visitorHash = makeVisitorHash({ ip, userAgent, date });
  return {
    ...parseUserAgent(userAgent),
    referrer: referrerDomain(referrer),
    isBot: isBotUserAgent(userAgent),
    visitorHash,
    isRefresh: await checkRefresh(String(linkId), visitorHash),
  };
}
