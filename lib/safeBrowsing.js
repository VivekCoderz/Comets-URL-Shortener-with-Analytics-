import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { getRedis } from "@/lib/redis";

// Blocks malicious destinations (board task CMT-52, PRD FR-13, test T14).
//
// Every new or edited long URL goes through checkUrlSafety() before it is saved:
//   1. Local blocklist: other URL shorteners. A short link to another short link
//      hides the real destination twice (chain redirects), so we refuse it.
//   2. Redis cache: safe:{SHA-256 of the URL}, kept 6 hours, so the same URL
//      doesn't use up our free Google quota again and again.
//   3. Google Safe Browsing Lookup API (v4 threatMatches:find).
//
// Result: "safe", "unsafe" or "unchecked" (the Link model's safetyStatus values).
//   unsafe     the route answers 422 "This URL is flagged as unsafe"
//   unchecked  Google could not be asked (no key, down, slow): the link is saved
//              anyway (PRD FR-13) and the scheduled job re-checks it later.

export const UNSAFE_URL_MESSAGE = "This URL is flagged as unsafe"; // same text as the forms (CMT-50)

const SAFE_CACHE_SECONDS = 6 * 60 * 60; // 6 hours (PRD FR-13)
const GOOGLE_TIMEOUT_MS = 3000; // don't make the user wait long if Google is slow
const LOOKUP_URL = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

// Other URL shorteners (team decision, 19 Nov). A subdomain counts too:
// "www.bit.ly" and "m.bit.ly" are blocked like "bit.ly".
export const BLOCKED_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
];

// Our own domain is blocked as well, subdomains included (validators.js already
// refuses the exact same host).
function blockedDomains() {
  const ownHost = new URL(getEnv().NEXT_PUBLIC_BASE_URL).hostname;
  return [...BLOCKED_DOMAINS, ownHost];
}

export function isBlockedDomain(url) {
  // "BIT.LY." and "bit.ly" are the same host: lower-case, drop a trailing dot.
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  return blockedDomains().some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function cacheKey(url, prefix) {
  return `${prefix}safe:${createHash("sha256").update(url).digest("hex")}`;
}

// Redis is only a cache here: if it fails we just ask Google (or save as unchecked).
async function readCache(key) {
  try {
    const value = await getRedis().get(key);
    return value === "safe" || value === "unsafe" ? value : null;
  } catch (error) {
    console.warn(`[safe-browsing] cache read failed: ${error?.message ?? error}`);
    return null;
  }
}

async function writeCache(key, status) {
  try {
    await getRedis().set(key, status, { ex: SAFE_CACHE_SECONDS });
  } catch (error) {
    console.warn(`[safe-browsing] cache write failed: ${error?.message ?? error}`);
  }
}

// Asks Google about one URL. Returns "safe", "unsafe", or null when Google
// could not answer (network error, timeout, bad key, quota used up…).
async function askGoogle(url, apiKey) {
  try {
    const res = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "comets-url-shortener", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[safe-browsing] Google answered ${res.status}, saving as unchecked`);
      return null;
    }
    // Google sends {} for a clean URL, and { matches: [...] } for a flagged one.
    const body = await res.json();
    return body?.matches?.length ? "unsafe" : "safe";
  } catch (error) {
    console.warn(`[safe-browsing] Google not reachable, saving as unchecked: ${error?.message ?? error}`);
    return null;
  }
}

// Returns "safe", "unsafe" or "unchecked". Never throws, so a Safe Browsing
// problem can never stop people from creating links.
// `apiKey` and `prefix` are only for tests (a fake key, own Redis keys).
export async function checkUrlSafety(url, { apiKey = getEnv().GOOGLE_SAFE_BROWSING_API_KEY, prefix = "" } = {}) {
  if (isBlockedDomain(url)) return "unsafe";

  // No key yet (e.g. a teammate's laptop): same as Google being down.
  if (!apiKey) return "unchecked";

  const key = cacheKey(url, prefix);
  const cached = await readCache(key);
  if (cached) return cached;

  const status = await askGoogle(url, apiKey);
  if (!status) return "unchecked"; // not cached, so the next try asks Google again
  await writeCache(key, status);
  return status;
}
