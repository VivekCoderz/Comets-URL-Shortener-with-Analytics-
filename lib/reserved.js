// Words that can never be used as a custom alias (PRD FR-04).
// Most are top-level routes of the app: if someone took /login or /api as an
// alias, their short link would hide (or break) that page.
// Keep this list in lower case; isReserved() lower-cases what it checks.
// No server-only code here, so the browser form can import it too.
export const RESERVED_WORDS = [
  "api",
  "login",
  "signup",
  "logout",
  "dashboard",
  "p",
  "expired",
  "link-not-found",
  "admin",
  "health",
  "pricing",
  "_next",
  "static",
  "assets",
  "qr",
  "docs",
  "help",
  "settings",
  "favicon.ico",
  "robots.txt",
];

const reservedSet = new Set(RESERVED_WORDS);

// Aliases are case-insensitive, so "API" and "Login" are reserved too.
export function isReserved(word) {
  return reservedSet.has(String(word).toLowerCase());
}
