import { z } from "zod";

// Shared QR code rules (PRD FR-10, board task CMT-38).
//
// This file is used by BOTH the browser (the QR designer preview and the guest
// download) and the server (lib/qrImage.js and the QR route), so every QR follows
// the same rules. Keep it free of server-only code (no sharp, no database).

// Error correction level H: the code can still be read with up to ~30% of it
// damaged. That is what lets a logo sit in the middle and the code still scan.
export const QR_ERROR_LEVEL = "H";

// Empty border around the code, in modules (the small squares). 4 is the size
// the QR standard asks for; scanners need it to find the code.
export const QR_MARGIN = 4;

// PNG size limits (PRD FR-10: 128–1,024 px). The designer offers these presets.
export const QR_MIN_SIZE = 128;
export const QR_MAX_SIZE = 1024;
export const QR_SIZE_PRESETS = [128, 256, 512, 1024];
export const QR_DEFAULT_SIZE = 512;

// Default colours before the user picks any (team decision: black on white).
export const QR_DEFAULT_STYLE = { fgColor: "#000000", bgColor: "#ffffff" };

// Logo upload rules. Max size was TBD in the PRD; the team chose 1 MB.
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg"];

// Max width and height of a logo in pixels (board task CMT-39).
// The file size limit alone is not enough: a 1 MB PNG of one colour can be
// 20,000 × 20,000 px, and opening it would need gigabytes of memory
// (a "decompression bomb"). The logo is drawn at most ~400 px wide, so 2,000 px
// is plenty for a sharp result.
export const LOGO_MAX_SIDE = 2000;

// The logo, together with the plain patch behind it, covers at most 15% of
// the QR's AREA (team decision). 15% of the area = a square whose side is
// √0.15 ≈ 39% of the code's side.
// Why not 20%: in a decode test, short links (small QR codes) with a 20% logo
// failed 23 of 72 times; with 15% all 72 decoded. 15% is still within the
// PRD's "at most ~20%".
export const LOGO_MAX_AREA = 0.15;

// Below this contrast ratio phones struggle to read the code. The designer
// shows a warning and the server refuses to save (team decision: 4.5 : 1).
export const MIN_CONTRAST = 4.5;

// ---- Text inside the QR ------------------------------------------------------

// The QR encodes the short URL with ?src=qr, so the redirect can count QR
// scans separately in analytics (see app/[code]/route.js).
export function qrUrlFor(shortUrl) {
  return `${shortUrl}?src=qr`;
}

// Download filename, e.g. "qr-geeta-fest.png" (PRD FR-10).
export function qrFilename(code) {
  return `qr-${code}.png`;
}

// ---- Colours and contrast ---------------------------------------------------

// Only "#rrggbb" is accepted. Lower-cased so "#FF0000" and "#ff0000" are the same.
export const hexColorSchema = z
  .string({ error: "Colour is required" })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1a2b3c")
  .transform((value) => value.toLowerCase());

// How bright a colour looks to the eye, from 0 (black) to 1 (white).
// Formula from WCAG 2: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contrast ratio between two colours: 1 (same colour) up to 21 (black on white).
export function contrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function hasEnoughContrast(fgColor, bgColor) {
  return contrastRatio(fgColor, bgColor) >= MIN_CONTRAST;
}

export const LOW_CONTRAST_MESSAGE = `Colours are too similar for phones to scan. Pick colours with more contrast (at least ${MIN_CONTRAST} : 1).`;

// Colours the user saves (PUT /api/links/[id]/qr). The route checks
// hasEnoughContrast() separately, so it can answer with its own error code
// (LOW_CONTRAST) instead of a general VALIDATION_ERROR.
export const qrColorsSchema = z.object({ fgColor: hexColorSchema, bgColor: hexColorSchema });

// ?size=… on the download route. Missing → the default size.
export const qrSizeSchema = z.coerce
  .number({ error: "Size must be a number" })
  .int("Size must be a whole number")
  .min(QR_MIN_SIZE, `Size must be at least ${QR_MIN_SIZE} px`)
  .max(QR_MAX_SIZE, `Size must be at most ${QR_MAX_SIZE} px`)
  .default(QR_DEFAULT_SIZE);

// An uploaded logo file: checked in the browser before preview, and again on
// the server. (The server also reads the file itself to make sure it really is
// a PNG/JPG, because the file type a browser sends can be faked.)
export const logoFileSchema = z
  .file({ error: "Logo must be a file" })
  .min(1, "Logo file is empty")
  .max(LOGO_MAX_BYTES, "Logo must be 1 MB or smaller")
  .mime(LOGO_TYPES, "Logo must be a PNG or JPG image");

// ---- Where things go in the image ---------------------------------------------

// Works out where the code and the logo are drawn in the PNG. Used by the
// server (sharp) and the browser (canvas), so both give the same picture.
//
//   imageSize   – PNG width/height in px (128–1,024)
//   moduleCount – how many modules wide the code is (from QRCode.create)
//
// Every module gets the same WHOLE number of pixels (`scale`). With a
// fractional scale (e.g. 2.8 px) some modules come out 2 px and some 3 px
// wide, and scanners misread them. The pixels left over become a slightly
// wider empty border, so the PNG is still exactly imageSize.
export function qrLayout(imageSize, moduleCount) {
  const scale = Math.max(1, Math.floor(imageSize / (moduleCount + QR_MARGIN * 2)));
  const drawnSize = (moduleCount + QR_MARGIN * 2) * scale; // code + standard border
  const offset = Math.floor((imageSize - drawnSize) / 2); // extra border on each side

  // The logo limit is measured on the code itself (without the border), so
  // a bigger border can't make the logo bigger.
  const codeSize = moduleCount * scale;
  const patchSize = Math.floor(codeSize * Math.sqrt(LOGO_MAX_AREA));
  // A small gap between the patch edge and the logo, so the logo doesn't
  // touch the dots around it.
  const padding = Math.round(patchSize * 0.08);
  const patchStart = offset + Math.round((drawnSize - patchSize) / 2);

  return {
    scale,
    drawnSize,
    offset,
    patchSize,
    patchStart,
    logoSize: patchSize - padding * 2,
    logoStart: patchStart + padding,
  };
}
