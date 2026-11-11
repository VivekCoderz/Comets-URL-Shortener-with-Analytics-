"use client";

import Modal from "@/components/Modal";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata", // IST, like the rest of the app (PRD 7.8)
});
const numberFormat = new Intl.NumberFormat("en-IN");

// "You already shortened this link" (screen 07, PRD FR-04b, test T19).
// Shown when POST /api/links answers { duplicate: true, existing }.
//   Use existing link → onUseExisting()   (the old link is used, nothing is created)
//   Create a new one  → onCreateNew()     (the form sends the request again with forceNew: true)
// The small QR code from screen 07 comes on Day 10 with the QR designer.
export default function DuplicatePrompt({ existing, busy, error, onUseExisting, onCreateNew, onClose }) {
  const shortUrlText = existing ? existing.shortUrl.replace(/^https?:\/\//, "") : "";
  const host = existing ? shortUrlText.slice(0, shortUrlText.length - existing.code.length) : "";

  return (
    <Modal open={Boolean(existing)} onClose={onClose} labelledBy="duplicate-title">
      {existing && (
        <>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-2xl">
              ♻️
            </span>
            <div>
              <h2 id="duplicate-title" className="text-lg font-semibold">
                You already shortened this link
              </h2>
              <p className="text-sm text-zinc-500">
                Created on {dateFormat.format(new Date(existing.createdAt))} ·{" "}
                {numberFormat.format(existing.totalClicks ?? 0)} clicks
              </p>
            </div>
          </div>

          <p className="mt-5 rounded-xl bg-linear-to-r from-violet-50 to-cyan-50 px-5 py-4 font-mono text-lg font-semibold break-all">
            <span className="text-zinc-800">{host}</span>
            <span className="bg-linear-to-r from-violet-500 to-cyan-500 bg-clip-text text-transparent">
              {existing.code}
            </span>
          </p>

          <p className="mt-3 text-sm text-zinc-500">
            Reuse it to keep all clicks in one place, or make a separate link (for example for a
            different campaign).
          </p>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCreateNew}
              disabled={busy}
              className="rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create a new one"}
            </button>
            <button
              type="button"
              onClick={onUseExisting}
              disabled={busy}
              className="rounded-xl bg-linear-to-r from-violet-500 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-200 hover:opacity-90 disabled:opacity-60"
            >
              Use existing link
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
