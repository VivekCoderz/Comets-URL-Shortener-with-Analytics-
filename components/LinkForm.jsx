"use client";

import { useState } from "react";
import { firstIssue, longUrlSchema } from "@/lib/validators";

// The "paste a long URL → Shorten" form, used on two pages (board CMT-10):
//   variant="hero" → home page, dark background (screens 01 and 03)
//   variant="card" → /dashboard/links, white card (screen 06)
// It works for guests and logged-in users: the browser sends the login cookie
// by itself, and POST /api/links decides who owns the new link (PRD FR-03).
// After a link is created it calls onCreated(link).
export default function LinkForm({ variant = "hero", onCreated }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const formElement = event.currentTarget;

    // Same URL rules as the server (lib/validators.js), so obvious mistakes
    // are shown at once without a request.
    const parsed = longUrlSchema.safeParse(new FormData(formElement).get("longUrl") ?? "");
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ longUrl: parsed.data }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Every API error is { error: { code, message } } (PRD section 9).
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      formElement.reset();
      onCreated?.(body.link);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const isHero = variant === "hero";

  const input = (
    <label className="relative flex flex-1 items-center">
      <span className="sr-only">Long URL</span>
      {isHero && (
        <span aria-hidden="true" className="pointer-events-none absolute left-4 text-zinc-400">
          🔗
        </span>
      )}
      <input
        name="longUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder={isHero ? "Paste a long link…" : "https://example.com/events/geeta-fest-2026"}
        className={
          isHero
            ? "w-full rounded-xl bg-white py-3.5 pr-4 pl-11 text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-4 focus:ring-violet-400/40"
            : "w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
        }
      />
    </label>
  );

  const button = (
    <button
      type="submit"
      disabled={loading}
      className="rounded-xl bg-linear-to-r from-violet-500 to-cyan-500 px-7 py-3.5 font-semibold text-white shadow-lg shadow-violet-500/30 hover:opacity-90 disabled:opacity-60"
    >
      {loading ? "Shortening…" : isHero ? "Shorten ⚡" : "Shorten"}
    </button>
  );

  // Errors appear under the box (screen 01 note).
  const errorText = error && (
    <p role="alert" className={`mt-3 text-sm ${isHero ? "text-red-300" : "text-red-600"}`}>
      {error}
    </p>
  );

  // noValidate: skip the browser's own popups so our Zod messages show instead.
  if (isHero) {
    return (
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur"
      >
        {/* One column on phones (screen 03), one row from small screens up (screen 01). */}
        <div className="flex flex-col gap-3 sm:flex-row">
          {input}
          {button}
        </div>
        {errorText}
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-3 font-semibold">Create a short link</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        {input}
        {button}
      </div>
      {errorText}
    </form>
  );
}
