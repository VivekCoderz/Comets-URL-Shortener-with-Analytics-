import { clearAuthCookie } from "@/lib/auth";

// POST /api/auth/logout  →  200 { ok: true }
// Deleting the cookie is enough: without it the browser has no token to send.
export async function POST() {
  await clearAuthCookie();
  return Response.json({ ok: true });
}
