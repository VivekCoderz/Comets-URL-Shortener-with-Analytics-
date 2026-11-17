import mongoose from "mongoose";
import { publicApiKey } from "@/lib/apiKey";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { ApiKeyModel } from "@/models/ApiKey";

// DELETE /api/keys/[id]  →  200 { apiKey }  (board task CMT-47)
// Revokes the key: it stops working at once and can never work again.
// The document is kept (with revokedAt) so the list still shows it.
// Someone else's key is a 404, not a 403, like links (CMT-15).
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const { id } = await params; // in Next.js 16, params is a Promise
  if (!mongoose.isValidObjectId(id)) return apiError("NOT_FOUND", "API key not found", 404);

  const key = await ApiKeyModel.findOne({ _id: id, userId: user._id });
  if (!key) return apiError("NOT_FOUND", "API key not found", 404);

  // Revoking twice is fine: keep the first revokedAt.
  if (!key.revokedAt) {
    key.revokedAt = new Date();
    await key.save();
  }
  return Response.json({ apiKey: publicApiKey(key) });
}
