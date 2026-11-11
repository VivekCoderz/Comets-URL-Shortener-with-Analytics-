"use client";

import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import LinkForm from "@/components/LinkForm";
import LinkTable from "@/components/LinkTable";

// /dashboard/links: create form on top, the user's links below (screen 06).
// proxy.js already sends logged-out users to /login before this page loads.
export default function MyLinksPage() {
  // Bumping this number makes LinkTable load the list again,
  // so a new link appears in the table straight after Shorten.
  const [refreshKey, setRefreshKey] = useState(0);
  // The old link the user chose with "Use existing link" (duplicate prompt).
  const [reused, setReused] = useState(null);

  function handleCreated(link, { existing }) {
    setReused(existing ? link : null);
    if (!existing) setRefreshKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <LinkForm variant="card" onCreated={handleCreated} />

      {reused && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm text-zinc-600">Using your existing link</p>
            <p className="truncate font-mono font-semibold text-violet-700">
              {reused.shortUrl.replace(/^https?:\/\//, "")}
            </p>
          </div>
          <div className="flex gap-2">
            <CopyButton text={reused.shortUrl} />
            <button
              type="button"
              onClick={() => setReused(null)}
              aria-label="Close"
              className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-violet-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <LinkTable refreshKey={refreshKey} />
    </div>
  );
}
