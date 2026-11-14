import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CopyButton from "@/components/CopyButton";
import LinkAnalytics from "@/components/LinkAnalytics";
import { getCurrentUser } from "@/lib/auth";
import { shortUrlFor } from "@/lib/links";
import { getHitsForLinks, getStatus, LINK_STATUS } from "@/lib/linkStatus";
import { LinkModel } from "@/models/Link";

// /dashboard/links/[id]: one link's details and analytics (Screen 08, FR-07).
// proxy.js already sends logged-out users to /login before this page loads.

// Badge text (PRD FR-08) and colour for each status from getStatus() (CMT-31).
const STATUS_BADGES = {
  [LINK_STATUS.ACTIVE]: { label: "Active", className: "bg-emerald-100 text-emerald-700" },
  [LINK_STATUS.EXPIRED_DATE]: { label: "Expired (date)", className: "bg-amber-100 text-amber-700" },
  [LINK_STATUS.EXPIRED_CLICKS]: { label: "Expired (clicks)", className: "bg-amber-100 text-amber-700" },
  [LINK_STATUS.DISABLED]: { label: "Disabled", className: "bg-zinc-100 text-zinc-600" },
};

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

  // Same status rules as the links list (lib/linkStatus.js). The click counter
  // lives in Redis, so read it first; links without a click limit get no
  // counter, and getStatus() then treats hits as 0.
  const hits = await getHitsForLinks([link]);
  const status = STATUS_BADGES[getStatus(link, hits.get(link.code) ?? 0)];

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
