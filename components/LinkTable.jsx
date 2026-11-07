"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";

// "3 Nov": dates are shown in IST, the same day boundary as the rest of the app (PRD 7.8).
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});
const numberFormat = new Intl.NumberFormat("en-IN");

// Table of the logged-in user's links (screen 06), loaded from GET /api/links.
// Columns for this task (board CMT-10): short link, destination, clicks, created + copy.
// Change `refreshKey` to load the list again, e.g. after a new link is created.
export default function LinkTable({ refreshKey = 0 }) {
  const [state, setState] = useState({ status: "loading", links: [], error: "" });

  useEffect(() => {
    // `ignore` stops an old, slower request from overwriting a newer one.
    let ignore = false;

    async function load() {
      try {
        const res = await fetch("/api/links");
        const body = await res.json().catch(() => null);
        if (ignore) return;
        if (!res.ok) {
          setState({
            status: "error",
            links: [],
            error: body?.error?.message ?? "Could not load your links.",
          });
          return;
        }
        setState({ status: "ready", links: body.links, error: "" });
      } catch {
        if (!ignore) {
          setState({ status: "error", links: [], error: "Could not reach the server." });
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  if (state.status === "loading" && state.links.length === 0) {
    return <TableMessage>Loading your links…</TableMessage>;
  }
  if (state.status === "error") {
    return <TableMessage tone="error">{state.error}</TableMessage>;
  }
  if (state.links.length === 0) {
    return <TableMessage>No links yet. Create your first one above.</TableMessage>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs font-medium tracking-wide text-zinc-500 uppercase">
          <tr>
            <th className="px-5 py-3 font-medium">Short link</th>
            <th className="px-5 py-3 font-medium">Destination</th>
            <th className="px-5 py-3 font-medium">Clicks</th>
            <th className="px-5 py-3 font-medium">Created</th>
            <th className="px-5 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {state.links.map((link) => (
            <tr key={link.id}>
              <td className="px-5 py-4 font-mono font-semibold text-violet-600">/{link.code}</td>
              {/* Long URLs are cut short; the full URL shows on hover (PRD FR-14). */}
              <td className="max-w-xs truncate px-5 py-4 text-zinc-600" title={link.longUrl}>
                {link.longUrl.replace(/^https?:\/\//, "")}
              </td>
              <td className="px-5 py-4 font-semibold">{numberFormat.format(link.totalClicks)}</td>
              <td className="px-5 py-4 whitespace-nowrap text-zinc-600">
                {dateFormat.format(new Date(link.createdAt))}
              </td>
              <td className="px-5 py-4 text-right">
                <CopyButton text={link.shortUrl} label="" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableMessage({ children, tone = "normal" }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-2xl border border-zinc-200 bg-white px-5 py-10 text-center text-sm shadow-sm ${
        tone === "error" ? "text-red-600" : "text-zinc-500"
      }`}
    >
      {children}
    </p>
  );
}
