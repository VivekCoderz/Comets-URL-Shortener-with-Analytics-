import mongoose, { Schema } from "mongoose";

// One document per short link (PRD v1.5, section 8.2).
const linkSchema = new Schema(
  {
    // Owner of the link. null means a guest created it (not logged in).
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // The short code or custom alias. `unique: true` creates the { code: 1 } unique index,
    // so saving a second link with the same code fails with error E11000.
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },

    isCustomAlias: { type: Boolean, required: true, default: false },

    // The API routes validate the URL with Zod first; this is a second safety net.
    longUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      match: [/^https?:\/\//i, "longUrl must start with http:// or https://"],
    },

    title: { type: String, trim: true },

    // Where the link was made. No default: the route that creates it must say.
    createdVia: { type: String, required: true, enum: ["guest", "dashboard", "api"] },

    // Set only when the link was created through the public API.
    apiKeyId: { type: Schema.Types.ObjectId, ref: "ApiKey", default: null },

    // Optional expiry rules: by date, or after a number of clicks.
    expiresAt: { type: Date, default: null },
    maxClicks: { type: Number, min: 1, default: null },

    // bcrypt hash for password-protected links. Hidden from queries by default.
    passwordHash: { type: String, select: false },

    // Custom QR code colours and logo. How logos are stored is still TBD in the PRD.
    qrStyle: {
      fgColor: { type: String },
      bgColor: { type: String },
      logoUrl: { type: String },
    },

    isActive: { type: Boolean, required: true, default: true }, // owner can disable it
    isDeleted: { type: Boolean, required: true, default: false }, // soft delete

    // Result of the Safe Browsing check. PRD lists no default; new links start "unchecked".
    safetyStatus: {
      type: String,
      required: true,
      enum: ["safe", "unsafe", "unchecked"],
      default: "unchecked",
    },
    safetyCheckedAt: { type: Date },

    // Incremented by the click flush (bots and refreshes are not counted).
    totalClicks: { type: Number, required: true, default: 0 },
    lastClickedAt: { type: Date },
  },
  { timestamps: true }, // adds createdAt and updatedAt
);

// "My links" on the dashboard, newest first.
linkSchema.index({ userId: 1, createdAt: -1 });
// Check if this user already shortened the same long URL.
linkSchema.index({ userId: 1, longUrl: 1 });
// Lets the re-check job find links by safety status quickly.
linkSchema.index({ safetyStatus: 1 });

// Reuse the model if it already exists, so Next.js hot reload
// does not throw OverwriteModelError. (We use `mongoose.models` instead of a
// named `models` import because plain Node, used by scripts/, cannot see that
// named export from the CommonJS mongoose package.)
export const LinkModel = mongoose.models.Link || mongoose.model("Link", linkSchema);
