import mongoose from "mongoose";
import { getCurrentUser } from "@/lib/auth";
import { apiError, readJson } from "@/lib/errors";
import { publicLink } from "@/lib/links";
import { editLinkSchema, firstIssue } from "@/lib/validators";
import { LinkModel } from "@/models/Link";

// Board task CMT-15: edit and delete a link, but only your own.
//
// Ownership rule: we always search with BOTH the link id AND the logged-in
// user's id. If the link belongs to someone else, the search finds nothing and
// we answer 404 "Link not found" — not 403. A 403 would tell an attacker
// "this link exists, it just isn't yours".

// Finds a link that belongs to `user` and is not deleted, or returns null.
async function findOwnLink(id, user) {
  // A bad id (e.g. "abc") can't match anything, so treat it as not found
  // instead of letting MongoDB throw a CastError.
  if (!mongoose.isValidObjectId(id)) return null;
  return LinkModel.findOne({ _id: id, userId: user._id, isDeleted: false });
}

// PATCH /api/links/[id]  { longUrl?, title?, isActive? }  →  200 { link }
export async function PATCH(request, { params }) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const parsed = editLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION_ERROR", firstIssue(parsed.error), 400);

  const { id } = await params; // in Next.js 16, params is a Promise
  const link = await findOwnLink(id, user);
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  // Only change the fields that were sent. Zod already removed any other
  // fields (like `code` or `userId`), so nobody can change those.
  for (const [field, value] of Object.entries(parsed.data)) {
    if (value !== undefined) link[field] = value;
  }
  await link.save();

  // TODO CMT-20 (Imran): delete the Redis cache key for link.code here, so the
  // redirect uses the new destination on the very next click.
  return Response.json({ link: publicLink(link) });
}

// DELETE /api/links/[id]  →  200 { ok: true }
// Soft delete: the document stays, with isDeleted = true. The code is never
// reused, so an old printed QR code can never open someone else's page (PRD 7.10).
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const { id } = await params;
  const link = await findOwnLink(id, user);
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  link.isDeleted = true;
  await link.save();

  // TODO CMT-20 (Imran): delete the Redis cache key for link.code here too.
  return Response.json({ ok: true });
}
