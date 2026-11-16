"use client";

import { useEffect, useRef, useState } from "react";
import DuplicatePrompt from "@/components/DuplicatePrompt";
import { getEnv } from "@/lib/env";
import { firstIssue, linkPasswordSchema, longUrlSchema } from "@/lib/validators";

// "comets.vercel.app/" shown in front of the alias box (screen 01).
const shortHost = `${new URL(getEnv({ publicOnly: true }).NEXT_PUBLIC_BASE_URL).host}/`;

// Error codes from POST /api/links that are about the alias (PRD sections 9 and 9.1).
// These show under the alias box; every other error shows under the URL box.
const ALIAS_ERRORS = ["ALIAS_TAKEN", "INVALID_ALIAS", "RESERVED_ALIAS"];

// Today's link quota { limit, used, remaining } from GET /api/auth/me (CMT-44),
// or null if it can't be read. Then the chip is simply not shown; the server
// still enforces the limit.
async function fetchQuota() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const body = await res.json();
    return body.quota ?? null;
  } catch {
    return null;
  }
}

// The "paste a long URL → Shorten" form, used on two pages:
//   variant="hero" → home page, dark background (screens 01 and 03)
//   variant="card" → /dashboard/links, white card (screen 06)
// It works for guests and logged-in users: the browser sends the login cookie
// by itself, and POST /api/links decides who owns the new link (PRD FR-03).
//
// After Shorten it calls onCreated(link, { existing }):
//   existing: false → a new link was made
//   existing: true  → the user chose "Use existing link" in the duplicate prompt
//
// Card variant only (logged-in users, CMT-44):
//   • "37 of 50 left today", read from GET /api/auth/me and read again after
//     each create. At 0 the Shorten button is disabled (the server also refuses).
//   • 🔒 Password chip: protects the new link with a password (6–128 characters).
export default function LinkForm({ variant = "hero", onCreated }) {
  const formRef = useRef(null);
  const [error, setError] = useState(""); // shown under the URL box
  const [aliasError, setAliasError] = useState(""); // shown under the alias box
  const [loading, setLoading] = useState(false);
  // Home page: the alias sits behind "Advanced options" (screens 01 and 03).
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Set when the server says "you already shortened this URL" (FR-04b).
  // `request` is kept so "Create a new one" can send the same thing again.
  const [duplicate, setDuplicate] = useState(null); // { existing, request } | null
  const [duplicateError, setDuplicateError] = useState("");
  // Card variant: today's quota { limit, used, remaining }, null until loaded.
  const [quota, setQuota] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const isCard = variant === "card";

  // Load the quota once when the dashboard form appears.
  // `ignore` stops a late answer from updating a form that is already gone.
  useEffect(() => {
    if (!isCard) return;
    let ignore = false;
    fetchQuota().then((latest) => {
      if (!ignore && latest) setQuota(latest);
    });
    return () => {
      ignore = true;
    };
  }, [isCard]);

  async function loadQuota() {
    const latest = await fetchQuota();
    if (latest) setQuota(latest);
  }

  // Sends one create request and handles every kind of answer.
  async function createLink(request) {
    setLoading(true);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // Every API error is { error: { code, message } } (PRD section 9).
        const message = body?.error?.message ?? "Something went wrong. Please try again.";
        if (duplicate) setDuplicateError(message); // popup is open: show it there
        else if (ALIAS_ERRORS.includes(body?.error?.code)) setAliasError(message);
        else setError(message);
        return;
      }

      // 200 { duplicate: true, existing }: nothing was created yet, ask the user.
      if (body?.duplicate) {
        setDuplicate({ existing: body.existing, request });
        return;
      }

      // 201 { link }: done.
      formRef.current?.reset();
      setShowPassword(false);
      setDuplicate(null);
      onCreated?.(body.link, { existing: false });
    } catch {
      const message = "Could not reach the server. Check your connection and try again.";
      if (duplicate) setDuplicateError(message);
      else setError(message);
    } finally {
      setLoading(false);
      // The count changes after a create (and a 429 means our number was old).
      if (isCard) loadQuota();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setAliasError("");
    setPasswordError("");
    const form = new FormData(event.currentTarget);

    // Same URL rules as the server (lib/validators.js), so obvious mistakes
    // are shown at once without a request.
    const parsed = longUrlSchema.safeParse(form.get("longUrl") ?? "");
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    // The alias rules (length, characters, reserved words) are checked by the
    // server (CMT-16), which sends a clear message we show under the box.
    const request = { longUrl: parsed.data };
    const alias = String(form.get("alias") ?? "").trim();
    if (alias) request.alias = alias;

    // Password chip (card only). An empty box means "no password".
    const password = String(form.get("password") ?? "");
    if (isCard && showPassword && password.trim()) {
      const checked = linkPasswordSchema.safeParse(password);
      if (!checked.success) {
        setPasswordError(firstIssue(checked.error));
        return;
      }
      request.password = checked.data;
    }

    await createLink(request);
  }

  function useExisting() {
    const { existing } = duplicate;
    formRef.current?.reset();
    setDuplicate(null);
    setDuplicateError("");
    onCreated?.(existing, { existing: true });
  }

  function createNew() {
    setDuplicateError("");
    // Same request again; forceNew tells the server to skip the duplicate check.
    createLink({ ...duplicate.request, forceNew: true });
  }

  function closePrompt() {
    setDuplicate(null);
    setDuplicateError("");
  }

  const isHero = variant === "hero";

  const urlInput = (
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
        aria-invalid={Boolean(error)}
        placeholder={isHero ? "Paste a long link…" : "https://example.com/events/geeta-fest-2026"}
        className={
          isHero
            ? "w-full rounded-xl bg-white py-3.5 pr-4 pl-11 text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-4 focus:ring-violet-400/40"
            : "w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
        }
      />
    </label>
  );

  // No links left today: Shorten can't be used until midnight (India time).
  const outOfLinks = isCard && quota !== null && quota.remaining <= 0;

  const button = (
    <button
      type="submit"
      disabled={loading || outOfLinks}
      className="rounded-xl bg-linear-to-r from-violet-500 to-cyan-500 px-7 py-3.5 font-semibold text-white shadow-lg shadow-violet-500/30 hover:opacity-90 disabled:opacity-60"
    >
      {loading && !duplicate ? "Shortening…" : isHero ? "Shorten ⚡" : "Shorten"}
    </button>
  );

  const errorText = (message, id) =>
    message && (
      <p id={id} role="alert" className={`mt-2 text-sm ${isHero ? "text-red-300" : "text-red-600"}`}>
        {message}
      </p>
    );

  // Only exists while the server has reported a duplicate.
  const prompt = duplicate && (
    <DuplicatePrompt
      existing={duplicate.existing}
      busy={loading}
      error={duplicateError}
      onUseExisting={useExisting}
      onCreateNew={createNew}
      onClose={closePrompt}
    />
  );

  // noValidate: skip the browser's own popups so our messages show instead.
  if (isHero) {
    return (
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-left backdrop-blur"
      >
        {/* One column on phones (screen 03), one row from small screens up (screen 01). */}
        <div className="flex flex-col gap-3 sm:flex-row">
          {urlInput}
          {button}
        </div>
        {errorText(error, "url-error")}

        {/* ⚙ Advanced options → comets.vercel.app/ [custom-alias (optional)] (screen 01) */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-sm">
          <button
            type="button"
            onClick={() => setShowAdvanced((open) => !open)}
            aria-expanded={showAdvanced}
            aria-controls="advanced-options"
            className="text-zinc-300 hover:text-white"
          >
            ⚙ Advanced options
          </button>
          {showAdvanced && (
            <label id="advanced-options" className="flex items-center gap-2">
              <span className="font-mono text-xs text-zinc-400">{shortHost}</span>
              <input
                name="alias"
                autoComplete="off"
                spellCheck={false}
                aria-label="Custom alias (optional)"
                aria-invalid={Boolean(aliasError)}
                placeholder="custom-alias (optional)"
                className="w-48 rounded-lg border border-dashed border-white/30 bg-white/5 px-3 py-1.5 text-white outline-none placeholder:text-zinc-400 focus:border-violet-400"
              />
            </label>
          )}
        </div>
        {errorText(aliasError, "alias-error")}
        {prompt}
      </form>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Create a short link</h2>
        {/* "● 37 of 50 left today" (screen 06). */}
        {quota && (
          <p
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              outOfLinks ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${outOfLinks ? "bg-red-500" : "bg-emerald-500"}`} />
            {quota.remaining} of {quota.limit} left today
          </p>
        )}
      </div>
      {/* URL · / alias (optional) · Shorten, in one row (screen 06). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex flex-1 flex-col">
          {urlInput}
          {errorText(error, "url-error")}
        </div>
        <div className="flex flex-col sm:w-56">
          <input
            name="alias"
            autoComplete="off"
            spellCheck={false}
            aria-label="Custom alias (optional)"
            aria-invalid={Boolean(aliasError)}
            placeholder="/ alias (optional)"
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
          />
          {errorText(aliasError, "alias-error")}
        </div>
        {button}
      </div>

      {outOfLinks && (
        <p role="status" className="mt-2 text-sm text-red-600">
          You have used all {quota.limit} links for today. You can create more after midnight (India time).
        </p>
      )}

      {/* Advanced: 🔒 Password (screen 06). Expiry and max-clicks chips come in their own task. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Advanced:</span>
        <button
          type="button"
          onClick={() => {
            setShowPassword((open) => !open);
            setPasswordError("");
          }}
          aria-expanded={showPassword}
          aria-controls="link-password"
          className={`rounded-full border px-3 py-1 ${
            showPassword ? "border-violet-300 bg-violet-50 text-violet-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          🔒 Password
        </button>
        {showPassword && (
          <input
            id="link-password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-label="Link password"
            aria-invalid={Boolean(passwordError)}
            placeholder="Link password (6+ characters)"
            className="w-64 rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
          />
        )}
      </div>
      {errorText(passwordError, "password-error")}
      {prompt}
    </form>
  );
}
