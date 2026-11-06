import mongoose, { Schema } from "mongoose";

// One document per link per IST day. PRD section 8.5.
// The click flush adds to these with $inc upserts, so dashboards never scan raw clicks.
const dailyStatSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "Link", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null }, // null = guest link

    // "YYYY-MM-DD" in IST (Asia/Kolkata).
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    clicks: { type: Number, required: true, default: 0 }, // non-bot, non-refresh clicks
    uniqueClicks: { type: Number, required: true, default: 0 }, // distinct visitor hashes
    refreshes: { type: Number, required: true, default: 0 }, // shown in "extra details"
    qrClicks: { type: Number, required: true, default: 0 }, // clicks with source = qr

    // Breakdowns, e.g. byCountry: { IN: 40, US: 3 }.
    // MongoDB keys cannot contain dots, so "instagram.com" is stored as "instagram_com".
    byCountry: { type: Map, of: Number, default: {} },
    byDevice: { type: Map, of: Number, default: {} },
    byBrowser: { type: Map, of: Number, default: {} },
    byOs: { type: Map, of: Number, default: {} },
    byReferrer: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

// Exactly one document per link per day, so two flushes can't create duplicates.
dailyStatSchema.index({ linkId: 1, day: 1 }, { unique: true });
// The dashboard overview reads all of a user's days.
dailyStatSchema.index({ userId: 1, day: 1 });

export const DailyStatModel = mongoose.models.DailyStat || mongoose.model("DailyStat", dailyStatSchema);
