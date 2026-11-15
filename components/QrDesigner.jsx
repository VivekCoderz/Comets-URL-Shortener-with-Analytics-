"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import {
  contrastRatio,
  hasEnoughContrast,
  logoFileSchema,
  MIN_CONTRAST,
  QR_DEFAULT_SIZE,
  QR_DEFAULT_STYLE,
  QR_ERROR_LEVEL,
  QR_MARGIN,
  QR_SIZE_PRESETS,
  qrFilename,
  qrLayout,
  qrUrlFor,
} from "@/lib/qr";

// QR designer (PRD FR-10, board task CMT-38): colours, centre logo, live
// preview, size presets and PNG download.
//
// Two modes:
//   guest – nothing is saved. The PNG is made right here in the browser.
//   owner – logged-in user's link. "Save" stores the style with the link
//           (PUT /api/links/[id]/qr) and "Download" gets the PNG from the server
//           (GET /api/links/[id]/qr), so the saved QR is what gets printed.
//
// The preview uses the same rules as the server (lib/qr.js): level H, same
// border, same logo patch. So what you see is what downloads.

// Draws the QR on a <canvas> at the real pixel size, the same way as the
// server (lib/qrImage.js): whole-pixel modules, extra border, patch, logo.
async function drawQr(canvas, { text, size, fgColor, bgColor, logoImage }) {
  const moduleCount = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_LEVEL }).modules.size;
  const { scale, offset, patchSize, patchStart, logoSize, logoStart } = qrLayout(size, moduleCount);

  // Draw the code on a separate canvas first, then copy it into the middle.
  const codeCanvas = document.createElement("canvas");
  await QRCode.toCanvas(codeCanvas, text, {
    errorCorrectionLevel: QR_ERROR_LEVEL,
    margin: QR_MARGIN,
    scale,
    color: { dark: fgColor, light: bgColor },
  });

  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = bgColor;
  context.fillRect(0, 0, size, size);
  context.drawImage(codeCanvas, offset, offset);
  if (!logoImage) return;

  // Plain patch in the background colour, so no dots show behind the logo.
  context.fillStyle = bgColor;
  context.fillRect(patchStart, patchStart, patchSize, patchSize);

  // Fit the logo inside its square without stretching it (like sharp's "contain").
  const logoScale = Math.min(logoSize / logoImage.width, logoSize / logoImage.height);
  const width = logoImage.width * logoScale;
  const height = logoImage.height * logoScale;
  context.drawImage(
    logoImage,
    logoStart + (logoSize - width) / 2,
    logoStart + (logoSize - height) / 2,
    width,
    height,
  );
}

// Loads an image from a URL (a saved logo or a picked file) for the canvas.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the logo"));
    image.src = src;
  });
}

export default function QrDesigner({ mode, code, shortUrl, linkId = null, initialStyle = null }) {
  const isOwner = mode === "owner";
  const canvasRef = useRef(null);

  const [saved, setSaved] = useState({
    fgColor: initialStyle?.fgColor ?? QR_DEFAULT_STYLE.fgColor,
    bgColor: initialStyle?.bgColor ?? QR_DEFAULT_STYLE.bgColor,
    logoUrl: initialStyle?.logoUrl ?? null,
  });
  const [fgColor, setFgColor] = useState(saved.fgColor);
  const [bgColor, setBgColor] = useState(saved.bgColor);
  const [size, setSize] = useState(QR_DEFAULT_SIZE);
  // A newly picked logo file (not saved yet), and the address used to preview it.
  const [logoFile, setLogoFile] = useState(null);
  const [logoSrc, setLogoSrc] = useState(saved.logoUrl);
  const [status, setStatus] = useState({ type: "idle", message: "" }); // idle | saving | saved | error

  const text = qrUrlFor(shortUrl);
  const contrastOk = hasEnoughContrast(fgColor, bgColor);
  // Owner: has anything changed since the last save?
  const dirty =
    fgColor !== saved.fgColor || bgColor !== saved.bgColor || logoFile !== null || logoSrc !== saved.logoUrl;

  // Redraw the preview whenever something changes (the live preview).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const logoImage = logoSrc ? await loadImage(logoSrc).catch(() => null) : null;
      if (!cancelled && canvasRef.current) {
        await drawQr(canvasRef.current, { text, size, fgColor, bgColor, logoImage });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, size, fgColor, bgColor, logoSrc]);

  // Free the temporary address made for a picked file when it is replaced.
  useEffect(() => {
    if (!logoSrc?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(logoSrc);
  }, [logoSrc]);

  function handleLogoPick(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be picked again later
    if (!file) return;
    const check = logoFileSchema.safeParse(file);
    if (!check.success) {
      setStatus({ type: "error", message: check.error.issues[0].message });
      return;
    }
    setStatus({ type: "idle", message: "" });
    setLogoFile(file);
    setLogoSrc(URL.createObjectURL(file));
  }

  function handleLogoRemove() {
    setLogoFile(null);
    setLogoSrc(null);
  }

  async function handleSave() {
    setStatus({ type: "saving", message: "" });
    const form = new FormData();
    form.set("fgColor", fgColor);
    form.set("bgColor", bgColor);
    if (logoFile) form.set("logo", logoFile);
    else if (!logoSrc && saved.logoUrl) form.set("removeLogo", "true");

    try {
      const response = await fetch(`/api/links/${linkId}/qr`, { method: "PUT", body: form });
      const body = await response.json();
      if (!response.ok) {
        setStatus({ type: "error", message: body.error?.message ?? "Could not save the QR" });
        return;
      }
      // Show the saved logo from the server from now on. The ?t= makes the
      // browser load the new image instead of an older one at the same address.
      const savedLogo = body.qrStyle.logoUrl ? `${body.qrStyle.logoUrl}?t=${Date.now()}` : null;
      setSaved({ ...body.qrStyle, logoUrl: savedLogo });
      setLogoSrc(savedLogo);
      setLogoFile(null);
      setStatus({ type: "saved", message: "QR style saved" });
    } catch {
      setStatus({ type: "error", message: "Network error. Please try again." });
    }
  }

  // Guest download: turn the canvas into a PNG file and save it.
  function handleGuestDownload() {
    canvasRef.current.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = qrFilename(code);
      anchor.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  const buttonClass = "rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 sm:flex-row">
      {/* Live preview. Drawn at the real size, shown smaller on screen. */}
      <div className="flex shrink-0 flex-col items-center gap-2">
        <canvas
          ref={canvasRef}
          aria-label={`QR code for ${shortUrl}`}
          className="h-48 w-48 rounded-lg border border-zinc-200"
        />
        <p className="text-xs text-zinc-500">
          {size} × {size} px
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        <h2 className="text-lg font-semibold">QR code</h2>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="color"
              value={fgColor}
              onChange={(event) => setFgColor(event.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-zinc-200"
            />
            Foreground
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="color"
              value={bgColor}
              onChange={(event) => setBgColor(event.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-zinc-200"
            />
            Background
          </label>
        </div>

        {/* Low contrast: warn here; the server refuses to save it (team decision). */}
        {!contrastOk && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ Low contrast ({contrastRatio(fgColor, bgColor).toFixed(1)} : 1). Phones may not scan this code.
            Use colours with at least {MIN_CONTRAST} : 1.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className={`${buttonClass} cursor-pointer border border-zinc-200 hover:bg-zinc-50`}>
            {logoSrc ? "Change logo" : "Add logo"}
            <input type="file" accept="image/png,image/jpeg" onChange={handleLogoPick} className="sr-only" />
          </label>
          {logoSrc && (
            <button type="button" onClick={handleLogoRemove} className="text-sm text-zinc-500 hover:underline">
              Remove logo
            </button>
          )}
          <span className="text-xs text-zinc-500">PNG or JPG, max 1 MB</span>
        </div>

        <fieldset className="flex flex-wrap items-center gap-2 text-sm">
          <legend className="sr-only">PNG size</legend>
          <span className="mr-1 text-zinc-600">Size</span>
          {QR_SIZE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={size === preset}
              onClick={() => setSize(preset)}
              className={`rounded-lg border px-3 py-1 ${
                size === preset ? "border-violet-500 bg-violet-50 text-violet-700" : "border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              {preset}
            </button>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {isOwner && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || status.type === "saving"}
              className={`${buttonClass} bg-zinc-900 text-white hover:bg-zinc-800`}
            >
              {status.type === "saving" ? "Saving…" : "Save style"}
            </button>
          )}

          {isOwner ? (
            // Download the saved QR from the server. Unsaved changes are not in it, so ask to save first.
            dirty ? (
              <span className="text-sm text-zinc-500">Save your changes to download</span>
            ) : (
              <a
                href={`/api/links/${linkId}/qr?size=${size}`}
                download={qrFilename(code)}
                className={`${buttonClass} bg-linear-to-r from-violet-500 to-cyan-500 text-white hover:opacity-90`}
              >
                ⬇ Download PNG
              </a>
            )
          ) : (
            <button
              type="button"
              onClick={handleGuestDownload}
              className={`${buttonClass} bg-linear-to-r from-violet-500 to-cyan-500 text-white hover:opacity-90`}
            >
              ⬇ Download PNG
            </button>
          )}
        </div>

        {status.message && (
          <p
            role="status"
            className={`text-sm ${status.type === "error" ? "text-red-600" : "text-emerald-600"}`}
          >
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
