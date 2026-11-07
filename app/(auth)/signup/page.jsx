"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { firstIssue, signupSchema } from "@/lib/validators";

const inputClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-normal outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100";

// Password strength bar under the field (screens PDF, screen 04).
// It is only a visual hint: the real rule is the 8+ characters in signupSchema.
function passwordStrength(password) {
  if (!password) return { score: 0, label: "" };
  if (password.length < 8) return { score: 1, label: "Too short" };
  let score = 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++; // mixed case
  if (/\d/.test(password)) score++; // a number
  if (/[^A-Za-z0-9]/.test(password)) score++; // a symbol
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
}

// /signup — create an account. The server route logs the user in
// (sets the cookie), so on success we go straight to the dashboard.
export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  const strength = passwordStrength(password);
  const tooShort = password.length > 0 && password.length < 8;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const input = {
      email: form.get("email"),
      password,
      // An empty name box means "no name", not a name of "".
      name: form.get("name") || undefined,
    };

    // Same schema the server uses, so a bad form never reaches the server.
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        // Every API error looks like { error: { code, message } },
        // e.g. "This email is already registered".
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
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">Free forever for 50 links a day.</p>

      {/* noValidate: skip the browser's own popups so Zod shows our messages. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <input name="name" type="text" autoComplete="name" placeholder="Riya Sharma" className={inputClass} />
        </label>

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
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <span className="flex items-center gap-2">
            {/* 4 bars; filled ones turn green (red while too short). */}
            <span className="flex flex-1 gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={`h-1 flex-1 rounded-full ${
                    bar <= strength.score ? (tooShort ? "bg-red-400" : "bg-emerald-500") : "bg-zinc-200"
                  }`}
                />
              ))}
            </span>
            <span className="text-xs font-normal text-zinc-500">
              {strength.label ? `${strength.label} · ` : ""}8+ characters
            </span>
          </span>
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
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-violet-600 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
