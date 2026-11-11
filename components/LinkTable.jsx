"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import Modal from "@/components/Modal";
import { firstIssue, longUrlSchema } from "@/lib/validators";

// "3 Nov": dates are shown in IST, the same day boundary as the rest of the app (PRD 7.8).
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});
const numberFormat = new Intl.NumberFormat("en-IN");

const inputClass =
  "w-full rounded-xl border border-zinc-300 px-4 py-2.5 font-normal outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100";
const smallButton =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50";

// Table of the logged-in user's links (screen 06), loaded from GET /api/links.
// Each row: short link, destination, clicks, created, and Copy / Edit / Delete.
// Change `refreshKey` to load the list again, e.g. after a new link is created.
export default function LinkTable({ refreshKey = 0 }) {
  const [state, setState] = useState({ status: "loading", links: [], error: "" });
  // Bumped after an edit or delete so the list is loaded again.
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(null); // the link in the edit popup
  const [deleting, setDeleting] = useState(null); // the link in the delete popup

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
  }, [refreshKey, version]);

  function reload() {
    setVersion((value) => value + 1);
  }

  let content;
  if (state.status === "loading" && state.links.length === 0) {
    content = <TableMessage>Loading your links…</TableMessage>;
  } else if (state.status === "error") {
    content = <TableMessage tone="error">{state.error}</TableMessage>;
  } else if (state.links.length === 0) {
    content = <TableMessage>No links yet. Create your first one above.</TableMessage>;
  } else {
    content = (
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
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <CopyButton text={link.shortUrl} label="" />
                    <button
                      type="button"
                      onClick={() => setEditing(link)}
                      aria-label={`Edit /${link.code}`}
                      className={smallButton}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(link)}
                      aria-label={`Delete /${link.code}`}
                      className={`${smallButton} text-red-600`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {content}
      {/* The popups only exist while open, so they always have a link to work on. */}
      {editing && (
        <EditLinkPopup
          link={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <DeleteLinkPopup
          link={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// Sends PATCH or DELETE to /api/links/[id] (Vivek, CMT-15).
// Returns "" on success, or the message to show.
async function sendChange(id, method, data) {
  try {
    const res = await fetch(`/api/links/${encodeURIComponent(id)}`, {
      method,
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
    if (res.ok) return "";
    const body = await res.json().catch(() => null);
    return body?.error?.message ?? "Something went wrong. Please try again.";
  } catch {
    return "Could not reach the server. Check your connection and try again.";
  }
}

// Edit popup: destination URL and title, the first two fields of screen 09.
// Expiry, max clicks and password are added to editing on their own days.
function EditLinkPopup({ link, onClose, onSaved }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setError("");
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);

    const parsed = longUrlSchema.safeParse(form.get("longUrl") ?? "");
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }
    const title = String(form.get("title") ?? "").trim();

    setSaving(true);
    // An empty title box removes the title (null).
    const message = await sendChange(link.id, "PATCH", { longUrl: parsed.data, title: title || null });
    setSaving(false);
    if (message) setError(message);
    else onSaved();
  }

  return (
    <Modal open={Boolean(link)} onClose={close} labelledBy="edit-title">
      {link && (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <h2 id="edit-title" className="font-mono text-lg font-semibold text-violet-600">
              /{link.code}
            </h2>
            <p className="text-sm text-zinc-500">The short code can&apos;t be changed after creation.</p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Destination URL
            <input name="longUrl" type="url" defaultValue={link.longUrl} className={inputClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Title
            <input
              name="title"
              defaultValue={link.title ?? ""}
              placeholder="Geeta Fest registrations"
              className={inputClass}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={`${smallButton} px-5 py-2.5`}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-linear-to-r from-violet-500 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Delete popup. It's a soft delete: the link stops working and its code is
// never given to anyone else (PRD rule 7.10).
function DeleteLinkPopup({ link, onClose, onDeleted }) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  function close() {
    setError("");
    onClose();
  }

  async function handleDelete() {
    setError("");
    setDeleting(true);
    const message = await sendChange(link.id, "DELETE");
    setDeleting(false);
    if (message) setError(message);
    else onDeleted();
  }

  return (
    <Modal open={Boolean(link)} onClose={close} labelledBy="delete-title">
      {link && (
        <>
          <h2 id="delete-title" className="text-lg font-semibold">
            Delete <span className="font-mono text-violet-600">/{link.code}</span>?
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            The short link will stop working, and this code can&apos;t be used again.
          </p>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={`${smallButton} px-5 py-2.5`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "🗑 Delete link"}
            </button>
          </div>
        </>
      )}
    </Modal>
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
