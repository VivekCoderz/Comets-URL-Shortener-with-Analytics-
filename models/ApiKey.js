import { Schema, model, models } from "mongoose";

export const API_KEY_SCOPES = ["links:read", "links:write", "analytics:read"];

// API keys for the public API (/api/v1). PRD section 8.4 and FR-12.
// The full key (sk_ + 32 characters) is shown to the user once and never stored.
const apiKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true }, // e.g. "College fest website"

    // First 8 characters of the key, shown in the UI (sk_7fa2…).
    keyPrefix: { type: String, required: true },

    // SHA-256 of the full key. select: false so it is never returned by accident;
    // the API-key lookup asks for it with .select("+keyHash") only when needed.
    keyHash: { type: String, required: true, unique: true, select: false },

    scopes: {
      type: [{ type: String, enum: API_KEY_SCOPES }],
      required: true,
      validate: {
        validator: (scopes) => scopes.length > 0,
        message: "An API key needs at least one scope",
      },
    },

    rateLimitPerMin: { type: Number, required: true, default: 60 },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date, default: null }, // set when revoked; a revoked key never works again
  },
  { timestamps: true },
);

// Listing a user's keys and counting active ones (max 5) filters on revokedAt.
apiKeySchema.index({ userId: 1, revokedAt: 1 });

export const ApiKeyModel = models.ApiKey || model("ApiKey", apiKeySchema);
