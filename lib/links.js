import { getEnv } from "@/lib/env";

// The full short link people share, e.g. https://cometurl.vercel.app/geeta-fest
export function shortUrlFor(code) {
  return `${getEnv().NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/${code}`;
}

// What we send to the browser for one link.
// Shared by the list route (GET) and the create route (POST, CMT-12),
// so both return links in the same shape. Never includes the password hash:
// only hasPassword (CMT-44), which needs the query to `.select("+passwordHash")`
// (the hash is hidden by default), otherwise it is always false.
export function publicLink(link) {
  return {
    id: String(link._id),
    code: link.code,
    shortUrl: shortUrlFor(link.code),
    longUrl: link.longUrl,
    title: link.title ?? null,
    isCustomAlias: link.isCustomAlias,
    isActive: link.isActive,
    expiresAt: link.expiresAt ?? null,
    maxClicks: link.maxClicks ?? null,
    totalClicks: link.totalClicks ?? 0,
    hasPassword: Boolean(link.passwordHash),
    // Safe Browsing result for the table badge (CMT-50): safe | unsafe | unchecked.
    safetyStatus: link.safetyStatus ?? "unchecked",
    createdAt: link.createdAt,
  };
}
