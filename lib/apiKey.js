import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/errors";
import { rateLimitHeaders, takeApiRequest } from "@/lib/rateLimit";
import { API_KEY_SCOPES, ApiKeyModel } from "@/models/ApiKey";
import { UserModel } from "@/models/User";

// API keys for the public API (board task CMT-47, PRD FR-12 and section 8.4).
//
// A key looks like  sk_Xq3v...  ("sk_" + 32 random characters).
// It is a password for apps, so we treat it like one:
//   - the full key is shown to the user ONCE, right after it is created
//   - the database keeps only its SHA-256 hash and the first 8 characters
//     (the prefix, so the user can tell keys apart: "sk_Xq3vA…")
// If the database ever leaks, the hashes can't be turned back into keys.
//
// SHA-256 (not bcrypt like passwords) is fine here: the key is 32 random
// characters, far too many to guess, and the API needs a fast exact lookup
// by hash on every request (Imran's key check, CMT-48).

export const KEY_PREFIX = "sk_";
export const KEY_PREFIX_LENGTH = 8; // characters shown in the UI, e.g. "sk_Xq3vA"
export const MAX_ACTIVE_KEYS = 5; // per user (PRD FR-12)

// 24 random bytes → 32 characters in base64url (A–Z a–z 0–9 - _), 192 bits.
export function generateApiKey() {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

// The same key always gives the same hash, so the key check can find it.
export function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

// What we send to the browser for one key. Never the hash (and the full key
// is never stored, so it can't leak from here either).
export function publicApiKey(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    keyPrefix: doc.keyPrefix,
    scopes: doc.scopes,
    lastUsedAt: doc.lastUsedAt ?? null,
    revokedAt: doc.revokedAt ?? null,
    createdAt: doc.createdAt,
  };
}

// POST /api/keys body: a name to recognise the key, and what it may do.
export const createApiKeySchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(50, "Name must be at most 50 characters"),
  scopes: z
    .array(z.enum(API_KEY_SCOPES, { error: `Scopes must be from: ${API_KEY_SCOPES.join(", ")}` }), {
      error: "Scopes must be a list",
    })
    .min(1, "Pick at least one scope")
    // ["links:read", "links:read"] → ["links:read"]
    .transform((scopes) => [...new Set(scopes)]),
});

// ---- Checking a key on every /api/v1 request (board task CMT-48) ---------------

// "Bearer sk_" + exactly 32 base64url characters, the shape generateApiKey() makes.
// Anything else is rejected before we even touch the database.
const BEARER_RE = /^Bearer (sk_[A-Za-z0-9_-]{32})$/;

// Every /api/v1 route starts with this:
//
//   const auth = await requireApiKey(request, "links:write");
//   if (auth.error) return auth.error;
//   // auth.user, auth.apiKey, auth.headers (X-RateLimit-*) are ready to use
//
// The checks, in this order:
//   1. Authorization: Bearer sk_… is present and well formed      else 401
//   2. a key with that SHA-256 hash exists                        else 401
//   3. the key is not revoked (revoked = 401 at once, PRD FR-12)  else 401
//   4. its owner still exists and is not blocked                  else 401
//   5. the key has the scope this route needs                     else 403
//   6. the key is under 60 requests this minute                   else 429
// Then lastUsedAt is updated.
//
// Only the Authorization header is read, never the login cookie, and the
// cookie routes (/api/keys) never read this header. So an API key can't
// create or revoke API keys (PRD FR-12).
//
// `prefix` and `now` are only for tests (own Redis counters, a fixed minute).
export async function requireApiKey(request, scope, { prefix = "", now = new Date() } = {}) {
  const invalid = () => ({
    error: apiError("UNAUTHORIZED", "Missing, invalid or revoked API key", 401),
  });

  const match = BEARER_RE.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match) return invalid();

  await connectDB();
  // keyHash has a unique index, so this is one fast lookup.
  const apiKey = await ApiKeyModel.findOne({ keyHash: hashApiKey(match[1]) });
  // Same message for "no such key" and "revoked", so a caller learns nothing extra.
  if (!apiKey || apiKey.revokedAt) return invalid();

  // Same rule as getCurrentUser(): a blocked user's keys stop working too.
  const user = await UserModel.findById(apiKey.userId);
  if (!user || user.status !== "active") return invalid();

  if (!apiKey.scopes.includes(scope)) {
    return {
      error: apiError("FORBIDDEN", `This API key does not have the ${scope} scope`, 403),
    };
  }

  const taken = await takeApiRequest({
    keyId: String(apiKey._id),
    limit: apiKey.rateLimitPerMin,
    now,
    prefix,
  });
  const headers = rateLimitHeaders(taken);
  if (!taken.ok) {
    const res = apiError(
      "RATE_LIMITED",
      `This API key can make ${taken.limit} requests per minute. Try again shortly.`,
      429,
    );
    for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
    res.headers.set("Retry-After", String(Math.max(1, taken.reset - Math.floor(now.getTime() / 1000))));
    return { error: res };
  }

  // updateOne (not save) so two requests at once don't overwrite each other.
  await ApiKeyModel.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: now } });

  return { apiKey, user, headers };
}
