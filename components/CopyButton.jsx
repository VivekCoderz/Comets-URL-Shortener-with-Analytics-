"use client";

import { useState } from "react";

// Copies the short link and shows "Copied" (board CMT-10) plus the
// "Link copied to clipboard" toast from screen 02.
// Used on the home page result and in every row of the links table.
export default function CopyButton({ text, label = "Copy", className = "" }) {
  const [status, setStatus] = useState("idle"); // "idle" | "copied" | "failed"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      // The clipboard API can be blocked (old browser, page not on https).
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${text}`}
        className={`rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 ${className}`}
      >
        {status === "copied" ? "Copied" : `📋 ${label}`.trim()}
      </button>

      {/* Toast, bottom right (screen 02). role="status" lets screen readers announce it. */}
      {status !== "idle" && (
        <div
          role="status"
          className="fixed right-6 bottom-6 z-50 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {status === "copied" ? (
            <>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs">
                ✓
              </span>
              Link copied to clipboard
            </>
          ) : (
            "Could not copy. Select the link and copy it by hand."
          )}
        </div>
      )}
    </>
  );
}
