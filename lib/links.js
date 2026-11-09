import { getEnv } from "@/lib/env";

// The full short link people share, e.g. https://cometurl.vercel.app/geeta-fest
export function shortUrlFor(code) {
  return `${getEnv().NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/${code}`;
}

// What we send to the browser for one link.
// Shared by the list route (GET) and the create route (POST, CMT-12),
// so both return links in the same shape. Never includes the password hash.
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
    createdAt: link.createdAt,
  };
}
