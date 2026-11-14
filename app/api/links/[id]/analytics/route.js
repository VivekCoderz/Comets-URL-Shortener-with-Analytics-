import mongoose from "mongoose";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { lastIstDays, summarizeStats } from "@/lib/stats";
import { analyticsRangeSchema, firstIssue } from "@/lib/validators";
import { DailyStatModel } from "@/models/DailyStat";
import { LinkModel } from "@/models/Link";

// GET /api/links/[id]/analytics?range=7|30|90   (board task CMT-26)
// Used by the link details page (Imran, Screen 08).
//
// Reads only the DailyStat documents (one per day), never the raw clicks, so
// even 90 days is at most 90 small documents.
//
// 200 {
//   range: 7, from: "2026-11-06", to: "2026-11-12",          // Indian days, today included
//   totals: { clicks, uniqueClicks, qrClicks, refreshes },
//   daily: [{ day: "2026-11-06", clicks: 0 }, …],            // every day, 0 if no clicks
//   breakdowns: { country, referrer, device, browser, os }  // e.g. referrer: { "instagram.com": 5, Direct: 2 }
// }
export async function GET(request, { params }) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const range = analyticsRangeSchema.safeParse(new URL(request.url).searchParams.get("range") ?? undefined);
  if (!range.success) return apiError("VALIDATION_ERROR", firstIssue(range.error), 400);

  // Same ownership rule as PATCH/DELETE (CMT-15): someone else's link is a
  // 404, not a 403, so nobody can find out which link ids exist.
  const { id } = await params; // in Next.js 16, params is a Promise
  const link = mongoose.isValidObjectId(id)
    ? await LinkModel.findOne({ _id: id, userId: user._id, isDeleted: false }, { _id: 1 }).lean()
    : null;
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  const days = lastIstDays(range.data);
  const stats = await DailyStatModel.find({
    linkId: link._id,
    day: { $gte: days[0], $lte: days[days.length - 1] },
  }).lean();

  return Response.json(summarizeStats(stats, days));
}
