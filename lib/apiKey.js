import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { API_KEY_SCOPES } from "@/models/ApiKey";

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
