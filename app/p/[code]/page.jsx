"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

export default function Page() {
  const params = useParams();
  const code = Array.isArray(params?.code) ? params.code[0] : params?.code ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/r/${code}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.redirected) {
        window.location.assign(res.url);
        return;
      }

      const body = await res.json().catch(() => null);
      const message = body?.error?.message ?? "Password is incorrect";
      setError(message);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
        <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Protected link</p>
        <h1 className="mt-3 text-2xl font-semibold">Enter the password</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400"
              placeholder="Enter the link password"
              required
            />
          </label>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-violet-500 px-4 py-3 font-medium text-white transition hover:bg-violet-400 disabled:opacity-60"
          >
            {loading ? "Checking…" : "Open link"}
          </button>
        </form>
      </div>
    </main>
  );
}
