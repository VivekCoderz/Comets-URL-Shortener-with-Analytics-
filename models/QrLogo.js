import mongoose, { Schema } from "mongoose";

// The centre logo of a saved QR code (PRD FR-10, board task CMT-38).
// Team decision: logos are stored in MongoDB, in their own collection, so the
// normal Link queries (links list, redirect) never load up to 1 MB of image data.
// Only logged-in users save logos; guests make their QR in the browser.
const qrLogoSchema = new Schema(
  {
    // One logo per link. `unique` creates the index used to find it.
    linkId: { type: Schema.Types.ObjectId, ref: "Link", required: true, unique: true },

    // "image/png" or "image/jpeg", sent back as the Content-Type when served.
    contentType: { type: String, required: true, enum: ["image/png", "image/jpeg"] },

    // The image file itself (max 1 MB, checked by the route before saving).
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

// Reuse the model on hot reload (same reason as models/Link.js).
export const QrLogoModel = mongoose.models.QrLogo || mongoose.model("QrLogo", qrLogoSchema);
