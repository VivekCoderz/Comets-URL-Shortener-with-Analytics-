import { createApiKeySchema, generateApiKey, hashApiKey, KEY_PREFIX_LENGTH, MAX_ACTIVE_KEYS, publicApiKey } from "@/lib/apiKey";
import { getCurrentUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/errors";
import { firstIssue } from "@/lib/validators";
import { ApiKeyModel } from "@/models/ApiKey";

// API keys of the logged-in user (board task CMT-47, PRD FR-12).
//
//   POST /api/keys  { name, scopes }  →  201 { key, apiKey }
//        `key` is the full key: shown ONCE, never returned again.
//   GET  /api/keys                    →  200 { apiKeys }  (prefix only)
//   DELETE /api/keys/[id] revokes a key (see ./[id]/route.js).

export async function POST(request) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const parsed = createApiKeySchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION_ERROR", firstIssue(parsed.error), 400);
  const { name, scopes } = parsed.data;

  // Max 5 working keys. Revoked keys don't count, so revoking one frees a slot.
  const active = await ApiKeyModel.countDocuments({ userId: user._id, revokedAt: null });
  if (active >= MAX_ACTIVE_KEYS) {
    return apiError(
      "KEY_LIMIT_REACHED",
      `You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke one to create a new key.`,
      409,
    );
  }

  const key = generateApiKey();
  const doc = await ApiKeyModel.create({
    userId: user._id,
    name,
    scopes,
    keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
    keyHash: hashApiKey(key), // only the hash is saved, never `key` itself
  });

  return Response.json({ key, apiKey: publicApiKey(doc) }, { status: 201 });
}

// Newest first. Revoked keys are listed too (with revokedAt), so the user
// can see what was turned off; the page can hide them if it wants.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  // keyHash has select: false in the model, so it is never loaded here.
  const keys = await ApiKeyModel.find({ userId: user._id }).sort({ createdAt: -1, _id: -1 });
  return Response.json({ apiKeys: keys.map(publicApiKey) });
}
