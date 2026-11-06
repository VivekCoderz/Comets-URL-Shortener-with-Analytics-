"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { firstIssue, loginSchema } from "@/lib/validators";

const inputClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-normal outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100";

// /login — on success the server sets the login cookie and we go to the dashboard.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const input = { email: form.get("email"), password: form.get("password") };

    // Same schema the server uses, so a bad form never reaches the server.
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        // Wrong email or wrong password → the server sends the same
        // "Invalid email or password" for both (PRD FR-02).
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Welcome back</h1>

      {/* noValidate: skip the browser's own popups so Zod shows our messages. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="riya@example.com"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input name="password" type="password" autoComplete="current-password" className={inputClass} />
        </label>

        {/* Errors from the form check or the server show in red above the button. */}
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-lg bg-linear-to-r from-violet-500 to-cyan-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200 hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-zinc-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-violet-600 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
