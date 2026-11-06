import mongoose, { Schema } from "mongoose";

// One document per redirect (a raw click event). PRD section 8.3.
// Only the click flush writes here, in batches (PRD section 4.2).
const clickSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "Link", required: true },
    // Copy of the link owner, so per-user queries don't need a join. null = guest link.
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // Time of the redirect, taken from the event, not the time of the insert.
    clickedAt: { type: Date, required: true },

    // SHA-256(IP + user-agent + salt + IST date). The raw IP is never stored.
    visitorHash: { type: String, required: true },

    country: { type: String, default: "Unknown" }, // ISO code from x-vercel-ip-country
    city: { type: String },
    device: { type: String, enum: ["mobile", "tablet", "desktop", "other"], default: "other" },
    browser: { type: String },
    os: { type: String },
    referrer: { type: String, default: "" }, // domain only, e.g. instagram.com; "" = Direct
    source: { type: String, enum: ["link", "qr"], required: true, default: "link" },

    isBot: { type: Boolean, required: true, default: false }, // excluded from charts
    isRefresh: { type: Boolean, required: true, default: false }, // excluded from total clicks

    // UUID created in the redirect. Unique, so a retried batch can't insert a click twice.
    eventId: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

// Per-link analytics read the newest clicks first.
clickSchema.index({ linkId: 1, clickedAt: -1 });

// TTL index: MongoDB deletes raw clicks 180 days after clickedAt (privacy, PRD section 6).
// Daily totals stay in dailystats.
clickSchema.index({ clickedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const ClickModel = mongoose.models.Click || mongoose.model("Click", clickSchema);
