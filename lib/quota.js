import { istDayStart } from "@/lib/time";
import { LinkModel } from "@/models/Link";

// Daily link limit for logged-in users (board task CMT-44, Screen 06:
// "37 of 50 left today"). The limit itself is user.dailyLinkLimit (50 by default).
//
// Team decision: we COUNT the user's links in MongoDB that were created since
// midnight India time (PRD rule 7.8), instead of keeping a separate counter.
// So the number is always right, and there is nothing to reset at midnight.
// Deleted links still count (they were created today), so deleting a link
// does not give a link back.
// The index { userId: 1, createdAt: -1 } on Link makes this count fast.
//
// Returns { limit, used, remaining }.
export async function getDailyQuota(user, now = new Date()) {
  const used = await LinkModel.countDocuments({
    userId: user._id,
    createdAt: { $gte: istDayStart(now) },
  });
  const limit = user.dailyLinkLimit;
  return { limit, used, remaining: Math.max(0, limit - used) };
}
