import mongoose from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { shortUrlFor } from "@/lib/links";
import {
  hasEnoughContrast,
  logoFileSchema,
  LOW_CONTRAST_MESSAGE,
  QR_DEFAULT_STYLE,
  qrColorsSchema,
  qrFilename,
  qrSizeSchema,
  qrUrlFor,
} from "@/lib/qr";
import { checkLogoImage, renderQrPng } from "@/lib/qrImage";
import { firstIssue } from "@/lib/validators";
import { LinkModel } from "@/models/Link";
import { QrLogoModel } from "@/models/QrLogo";

// QR code for a logged-in user's link (PRD FR-10, board task CMT-38).
//
//   GET /api/links/[id]/qr?size=512  →  the PNG file (download)
//   PUT /api/links/[id]/qr           →  save colours and logo with the link
//
// Guests have no account, so their QR is made in the browser instead
// (components/QrDesigner.jsx). Both use the same rules from lib/qr.js.
//
// Same ownership rule as the other /api/links/[id] routes (CMT-15): someone
// else's link is a 404, not a 403, so nobody can find out which ids exist.

async function findOwnLink(id, user) {
  if (!mongoose.isValidObjectId(id)) return null;
  return LinkModel.findOne({ _id: id, userId: user._id, isDeleted: false });
}

// The address the browser uses to show the saved logo (see ./logo/route.js).
function logoUrlFor(linkId) {
  return `/api/links/${linkId}/qr/logo`;
}

// GET → 200 image/png, downloaded as qr-<code>.png.
// A QR for an expired or disabled link still downloads (PRD FR-10); the
// redirect itself shows the expired page when someone scans it.
export async function GET(request, { params }) {
  const user = await getCurrentUser(); // also connects to MongoDB
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const size = qrSizeSchema.safeParse(new URL(request.url).searchParams.get("size") ?? undefined);
  if (!size.success) return apiError("VALIDATION_ERROR", firstIssue(size.error), 400);

  const { id } = await params; // in Next.js 16, params is a Promise
  const link = await findOwnLink(id, user);
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  // Saved colours, or black on white if the user never saved any.
  const fgColor = link.qrStyle?.fgColor ?? QR_DEFAULT_STYLE.fgColor;
  const bgColor = link.qrStyle?.bgColor ?? QR_DEFAULT_STYLE.bgColor;
  const logo = link.qrStyle?.logoUrl ? await QrLogoModel.findOne({ linkId: link._id }).lean() : null;

  const png = await renderQrPng({
    text: qrUrlFor(shortUrlFor(link.code)),
    size: size.data,
    fgColor,
    bgColor,
    logo: logo ? Buffer.from(logo.data.buffer ?? logo.data) : null,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // "attachment" makes the browser save the file instead of opening it.
      "Content-Disposition": `attachment; filename="${qrFilename(link.code)}"`,
      // The image changes when the style is saved, so never reuse an old copy.
      "Cache-Control": "private, no-store",
    },
  });
}

// "true" in the form means: delete the saved logo.
const removeLogoSchema = z.enum(["true", "false"]).optional();

// PUT, sent as multipart/form-data (because it can carry an image file):
//   fgColor     "#000000"   required
//   bgColor     "#ffffff"   required
//   logo        PNG/JPG     optional, max 1 MB, replaces the saved logo
//   removeLogo  "true"      optional, deletes the saved logo
// No logo and no removeLogo → the saved logo (if any) stays.
// → 200 { qrStyle: { fgColor, bgColor, logoUrl } }
export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return apiError("VALIDATION_ERROR", "Send the QR style as form data", 400);
  }

  const colors = qrColorsSchema.safeParse({
    fgColor: form.get("fgColor") ?? undefined,
    bgColor: form.get("bgColor") ?? undefined,
  });
  if (!colors.success) return apiError("VALIDATION_ERROR", firstIssue(colors.error), 400);
  const { fgColor, bgColor } = colors.data;

  // Low contrast is blocked on the server (team decision); the designer only warns.
  if (!hasEnoughContrast(fgColor, bgColor)) return apiError("LOW_CONTRAST", LOW_CONTRAST_MESSAGE, 400);

  const removeLogo = removeLogoSchema.safeParse(form.get("removeLogo") ?? undefined);
  if (!removeLogo.success) return apiError("VALIDATION_ERROR", "removeLogo must be true or false", 400);

  // An empty file input can arrive as "" or as an empty file; treat both as "no new logo".
  const logoField = form.get("logo");
  const hasNewLogo = logoField instanceof File && logoField.size > 0;
  let logoBytes = null;
  let logoType = null;
  if (hasNewLogo) {
    // 1. What the browser says: size (1 MB) and type (PNG/JPG).
    const logo = logoFileSchema.safeParse(logoField);
    if (!logo.success) return apiError("VALIDATION_ERROR", firstIssue(logo.error), 400);
    logoBytes = Buffer.from(await logo.data.arrayBuffer());
    // 2. What the file really is: real PNG/JPG, at most 2,000 × 2,000 px (CMT-39).
    const check = await checkLogoImage(logoBytes);
    if (!check.ok) return apiError("VALIDATION_ERROR", check.message, 400);
    logoType = check.contentType; // the real type, not the one the browser sent
  }

  const { id } = await params;
  const link = await findOwnLink(id, user);
  if (!link) return apiError("NOT_FOUND", "Link not found", 404);

  let logoUrl = link.qrStyle?.logoUrl ?? null;
  if (logoBytes) {
    // One logo per link: replace the old one if there is one.
    await QrLogoModel.findOneAndUpdate(
      { linkId: link._id },
      { contentType: logoType, data: logoBytes },
      { upsert: true },
    );
    logoUrl = logoUrlFor(link._id);
  } else if (removeLogo.data === "true") {
    await QrLogoModel.deleteOne({ linkId: link._id });
    logoUrl = null;
  }

  link.qrStyle = { fgColor, bgColor, logoUrl: logoUrl ?? undefined };
  await link.save();

  return Response.json({ qrStyle: { fgColor, bgColor, logoUrl } });
}
