import mongoose, { Schema } from "mongoose";

// One document per registered person (PRD v1.5, section 8.1).
const userSchema = new Schema(
  {
    // `unique: true` creates the { email: 1 } unique index.
    // lowercase + trim mean "Ali@Mail.com " and "ali@mail.com" are the same account.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // bcrypt hash, never the plain password.
    // `select: false` keeps it out of every query result unless we ask for it
    // with `.select("+passwordHash")` (only the login route should do that).
    passwordHash: { type: String, required: true, select: false },

    name: { type: String, trim: true },

    plan: { type: String, required: true, enum: ["free", "pro"], default: "free" },

    // Free users get 50 links per day. The Pro value is still TBD in the PRD.
    dailyLinkLimit: { type: Number, required: true, default: 50 },

    // Denormalised counters so the dashboard does not have to count links/clicks.
    stats: {
      totalLinks: { type: Number, default: 0 },
      totalClicks: { type: Number, default: 0 }, // updated by the click flush
    },

    lastLoginAt: { type: Date },

    // PRD lists no default; a new account starts as "active".
    status: { type: String, required: true, enum: ["active", "blocked"], default: "active" },

    // Pro billing fields (plan expiry, payment ID) come later, once FR-15 is decided.
  },
  { timestamps: true }, // adds createdAt and updatedAt
);

// Reuse the model if it already exists, so Next.js hot reload
// does not throw OverwriteModelError. (We use `mongoose.models` instead of a
// named `models` import because plain Node, used by scripts/, cannot see that
// named export from the CommonJS mongoose package.)
export const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
