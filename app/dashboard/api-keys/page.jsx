"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import Modal from "@/components/Modal";

// /dashboard/api-keys: create, see and revoke API keys (screen 10, PRD FR-12,
// board task CMT-46). The API itself is Vivek's /api/keys (CMT-47).
//
// The full key comes back ONLY in the POST /api/keys response. We show it once,
// with a Copy button and a warning. After the box is closed or the page is
// reloaded, only keyPrefix is shown ("sk_Xq3vA…"): the server never sends the
// full key again, because it only stores its hash.
// proxy.js already sends logged-out users to /login before this page loads.

// Same scopes as API_KEY_SCOPES in models/ApiKey.js.
const SCOPES = [
  { id: "links:read", label: "Read links" },
  { id: "links:write", label: "Create links" },
  { id: "analytics:read", label: "Read analytics" },
];

// Dates in IST, like the links table (PRD 7.8).
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const formatDate = (value) => (value ? dateFormat.format(new Date(value)) : "Never");

const inputClass =
  "w-full rounded-xl border border-zinc-300 px-4 py-2.5 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100";
const smallButton = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState({ status: "loading", list: [], error: "" });
  const [version, setVersion] = useState(0); // bump to load the list again
  // The full key from the last create. Lives only in this page's memory.
  const [newKey, setNewKey] = useState(null);
  const [revoking, setRevoking] = useState(null); // the key in the revoke popup

  useEffect(() => {
    let ignore = false; // an older, slower request must not overwrite a newer one
    (async () => {
      try {
        const res = await fetch("/api/keys");
        const body = await res.json().catch(() => null);
        if (ignore) return;
        if (!res.ok) {
          setKeys({ status: "error", list: [], error: body?.error?.message ?? "Could not load your API keys." });
          return;
        }
        setKeys({ status: "ready", list: body.apiKeys, error: "" });
      } catch {
        if (!ignore) setKeys({ status: "error", list: [], error: "Could not reach the server." });
      }
    })();
    return () => {
      ignore = true;
    };
  }, [version]);

  function handleCreated(result) {
    setNewKey(result);
    setVersion((value) => value + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Use a key to create links and read analytics from your own apps with the{" "}
          <code className="rounded bg-zinc-100 px-1">/api/v1</code> API. Send it as{" "}
          <code className="rounded bg-zinc-100 px-1">Authorization: Bearer sk_…</code>.
        </p>
      </header>

      {newKey && <NewKeyBox result={newKey} onDone={() => setNewKey(null)} />}

      <CreateKeyForm onCreated={handleCreated} />

      <KeyList state={keys} onRevoke={setRevoking} />

      <RevokeModal
        apiKey={revoking}
        onClose={() => setRevoking(null)}
        onRevoked={() => {
          setRevoking(null);
          setVersion((value) => value + 1);
        }}
      />
    </div>
  );
}

// The one and only time the full key is on screen.
function NewKeyBox({ result, onDone }) {
  return (
    <section
      aria-labelledby="new-key-title"
      className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"
    >
      <h2 id="new-key-title" className="font-semibold text-amber-900">
        Your new key “{result.apiKey.name}”
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm break-all">
          {result.key}
        </code>
        <CopyButton text={result.key} label="Copy key" />
      </div>
      <p role="alert" className="text-sm text-amber-900">
        ⚠ Copy this key now. You won&apos;t be able to see it again: we only keep a hashed copy. If you
        lose it, revoke it and create a new one.
      </p>
      <div>
        <button type="button" onClick={onDone} className={smallButton}>
          I&apos;ve copied it
        </button>
      </div>
    </section>
  );
}

function CreateKeyForm({ onCreated }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState([]);
  const [status, setStatus] = useState({ type: "idle", message: "" }); // idle | saving | error

  function toggleScope(id) {
    setScopes((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: "saving", message: "" });
    try {
      // The server checks name and scopes (createApiKeySchema) and the 5-key limit.
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus({ type: "error", message: body?.error?.message ?? "Could not create the key." });
        return;
      }
      setName("");
      setScopes([]);
      setStatus({ type: "idle", message: "" });
      onCreated(body); // { key, apiKey }
    } catch {
      setStatus({ type: "error", message: "Network error. Please try again." });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <h2 className="font-semibold">Create a key</h2>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={50}
          placeholder="e.g. College fest website"
          className={`${inputClass} font-normal`}
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1.5 font-medium">What can this key do?</legend>
        {SCOPES.map((scope) => (
          <label key={scope.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={scopes.includes(scope.id)}
              onChange={() => toggleScope(scope.id)}
              className="h-4 w-4 accent-violet-600"
            />
            {scope.label} <code className="text-xs text-zinc-500">{scope.id}</code>
          </label>
        ))}
      </fieldset>

      {status.type === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {status.message}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={status.type === "saving"}
          className="rounded-xl bg-linear-to-r from-violet-500 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {status.type === "saving" ? "Creating…" : "Create key"}
        </button>
      </div>
    </form>
  );
}

function KeyList({ state, onRevoke }) {
  if (state.status === "loading") return <Message>Loading your keys…</Message>;
  if (state.status === "error") return <Message tone="error">{state.error}</Message>;
  if (state.list.length === 0) return <Message>No API keys yet. Create one above.</Message>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs tracking-wide text-zinc-500 uppercase">
          <tr>
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-5 py-3 font-medium">Key</th>
            <th className="px-5 py-3 font-medium">Scopes</th>
            <th className="px-5 py-3 font-medium">Last used</th>
            <th className="px-5 py-3 font-medium">Created</th>
            <th className="px-5 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {state.list.map((apiKey) => (
            <tr key={apiKey.id} className={apiKey.revokedAt ? "text-zinc-400" : ""}>
              <td className="px-5 py-3 font-medium">{apiKey.name}</td>
              {/* Only the prefix: the full key is never sent again. */}
              <td className="px-5 py-3 font-mono">{apiKey.keyPrefix}…</td>
              <td className="px-5 py-3">{apiKey.scopes.join(", ")}</td>
              <td className="px-5 py-3">{formatDate(apiKey.lastUsedAt)}</td>
              <td className="px-5 py-3">{formatDate(apiKey.createdAt)}</td>
              <td className="px-5 py-3 text-right">
                {apiKey.revokedAt ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                    Revoked
                  </span>
                ) : (
                  <button type="button" onClick={() => onRevoke(apiKey)} className={`${smallButton} text-red-600`}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevokeModal({ apiKey, onClose, onRevoked }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setError("");
    onClose();
  }

  async function handleRevoke() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/keys/${apiKey.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not revoke the key.");
        return;
      }
      onRevoked();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(apiKey)} onClose={close} labelledBy="revoke-title">
      {apiKey && (
        <>
          <h2 id="revoke-title" className="text-lg font-semibold">
            Revoke “{apiKey.name}”?
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Apps using <span className="font-mono">{apiKey.keyPrefix}…</span> will stop working at once. This
            can&apos;t be undone.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className={smallButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Revoking…" : "Revoke key"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Message({ tone, children }) {
  return (
    <p
      className={`rounded-2xl border border-zinc-200 bg-white px-5 py-8 text-center text-sm ${
        tone === "error" ? "text-red-600" : "text-zinc-500"
      }`}
    >
      {children}
    </p>
  );
}
