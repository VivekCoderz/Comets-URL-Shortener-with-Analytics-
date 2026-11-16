import { getCurrentUser, publicUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { getDailyQuota } from "@/lib/quota";

// GET /api/auth/me  →  200 { user, quota }  or  401 when not logged in
// Pages call this to find out who is logged in.
// quota = { limit, used, remaining }: today's links (India day), shown as
// "37 of 50 left today" in the create form (CMT-44).
export async function GET() {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);
  return Response.json({ user: publicUser(user), quota: await getDailyQuota(user) });
}
