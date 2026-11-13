import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CopyButton from "@/components/CopyButton";
import LinkAnalytics from "@/components/LinkAnalytics";
import { getCurrentUser } from "@/lib/auth";
import { shortUrlFor } from "@/lib/links";
import { LinkModel } from "@/models/Link";

// /dashboard/links/[id]: one link's details and analytics (Screen 08, FR-07).
// proxy.js already sends logged-out users to /login before this page loads.

// Same rules as the redirect (app/[code]/route.js): turned off by the owner,
// or past its expiry date. (The max-clicks limit is counted in Redis, so it
// can't be checked here.)
function linkStatus(link) {
  if (!link.isActive) return { label: "Disabled", className: "bg-zinc-100 text-zinc-600" };
  if (link.expiresAt && link.expiresAt <= new Date()) {
    return { label: "Expired", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Active", className: "bg-emerald-100 text-emerald-700" };
}

async function LinkDetails({ params }) {
  // Reading the login cookie and params happens per request, which is why
  // this part sits inside <Suspense> (Cache Components is on).
  const user = await getCurrentUser(); // also connects to MongoDB
  const { id } = await params; // in Next.js 16, params is a Promise

  // Same ownership rule as the API: someone else's link is "not found".
  const link =
    user && mongoose.isValidObjectId(id)
      ? await LinkModel.findOne({ _id: id, userId: user._id, isDeleted: false }).lean()
      : null;
  if (!link) notFound();

  const shortUrl = shortUrlFor(link.code);
  const status = linkStatus(link);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-mono text-2xl font-semibold text-blue-700">/{link.code}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span className="truncate" title={link.longUrl}>
              → {link.longUrl.replace(/^https?:\/\//, "")}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
              {status.label}
            </span>
          </p>
        </div>
        <CopyButton text={shortUrl} />
      </header>

      <LinkAnalytics linkId={String(link._id)} />
    </div>
  );
}

export default function LinkDetailsPage({ params }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <LinkDetails params={params} />
    </Suspense>
  );
}
