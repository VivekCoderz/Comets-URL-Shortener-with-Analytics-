import mongoose from "mongoose";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { LinkModel } from "@/models/Link";
import { QrLogoModel } from "@/models/QrLogo";

// GET /api/links/[id]/qr/logo → the saved centre logo of a QR (board task CMT-38).
// The QR designer loads it to show the saved style in the live preview.
// Owner only, with the same "someone else's link is a 404" rule as the other routes.
export async function GET(_request, { params }) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const { id } = await params; // in Next.js 16, params is a Promise
  const link = mongoose.isValidObjectId(id)
    ? await LinkModel.findOne({ _id: id, userId: user._id, isDeleted: false }, { _id: 1 }).lean()
    : null;
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  const logo = await QrLogoModel.findOne({ linkId: link._id }).lean();
  if (!logo) return apiError("NOT_FOUND", "This link has no QR logo", 404);

  // .lean() returns the Buffer field as a BSON Binary; .buffer is the bytes.
  return new Response(new Uint8Array(logo.data.buffer ?? logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      // A new upload replaces the logo at the same address, so don't cache it.
      "Cache-Control": "private, no-store",
    },
  });
}
