import { getCurrentUser, publicUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";

// GET /api/auth/me  →  200 { user }  or  401 when not logged in
// Pages call this to find out who is logged in.
// (Today's remaining link quota is added on Day 11 with the rate limit.)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);
  return Response.json({ user: publicUser(user) });
}
