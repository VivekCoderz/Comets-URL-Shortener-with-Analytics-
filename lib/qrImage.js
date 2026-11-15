import QRCode from "qrcode";
import sharp from "sharp";
import { qrLayout, QR_ERROR_LEVEL, QR_MARGIN } from "@/lib/qr";

// Server-only: builds the QR PNG (PRD FR-10, board task CMT-38).
// The shared rules (level H, sizes, logo area) live in lib/qr.js, which the
// browser also uses; this file adds the parts that need Node (sharp).
//
// Steps:
//   1. `qrcode` draws the code in the chosen colours, each module a whole
//      number of pixels wide (see qrLayout in lib/qr.js).
//   2. `sharp` adds background around it so the PNG is exactly `size` px.
//   3. If there is a logo, `sharp` paints a plain square of the background
//      colour in the middle (the "patch") and puts the logo on top of it.
// Level H error correction lets phones read the code even with the middle covered.

// Returns a PNG Buffer.
export async function renderQrPng({ text, size, fgColor, bgColor, logo = null }) {
  const moduleCount = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_LEVEL }).modules.size;
  const layout = qrLayout(size, moduleCount);

  const codePng = await QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: QR_ERROR_LEVEL,
    margin: QR_MARGIN,
    scale: layout.scale,
    color: { dark: fgColor, light: bgColor },
  });

  // Fill the leftover pixels with background so the image is exactly size × size.
  const extra = size - layout.drawnSize;
  const fullPng = await sharp(codePng)
    .extend({
      top: layout.offset,
      left: layout.offset,
      bottom: extra - layout.offset,
      right: extra - layout.offset,
      background: bgColor,
    })
    .png()
    .toBuffer();
  if (!logo) return fullPng;

  // Shrink the logo to fit inside the patch, keeping its shape. "contain"
  // adds transparent space instead of cropping.
  const logoPng = await sharp(logo)
    .resize(layout.logoSize, layout.logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // A plain square in the background colour that clears the dots behind the logo.
  const patch = await sharp({
    create: { width: layout.patchSize, height: layout.patchSize, channels: 4, background: bgColor },
  })
    .png()
    .toBuffer();

  return sharp(fullPng)
    .composite([
      { input: patch, left: layout.patchStart, top: layout.patchStart },
      { input: logoPng, left: layout.logoStart, top: layout.logoStart },
    ])
    .png()
    .toBuffer();
}

// Checks that an upload really is a PNG or JPG image, by reading the file
// itself (the browser's file type can be faked). Returns true or false.
export async function isRealLogoImage(buffer) {
  try {
    const { format } = await sharp(buffer).metadata();
    return format === "png" || format === "jpeg";
  } catch {
    return false; // sharp could not read it, so it is not an image
  }
}
