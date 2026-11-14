import { z } from "zod";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { generateCode } from "@/lib/codeGen";
import { connectDB } from "@/lib/db";
import { apiError, readJson } from "@/lib/errors";
import { publicLink } from "@/lib/links";
import { getHitsForLinks, getStatus } from "@/lib/linkStatus";
import {
  aliasSchema,
  expiresAtSchema,
  firstIssue,
  linkPasswordSchema,
  listLinksQuerySchema,
  longUrlSchema,
  maxClicksSchema,
} from "@/lib/validators";
import { LinkModel } from "@/models/Link";

// GET /api/links?page=1&limit=20  →  200 { links, page, limit, total }
// Lists the logged-in user's own links, newest first (board task CMT-11).
// POST (create a link) is added in this same file by CMT-12.
export async function GET(request) {
  // getCurrentUser() also connects to MongoDB. Guests (no cookie) get null.
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "Please log in", 401);

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listLinksQuerySchema.safeParse(query);
  if (!parsed.success) return apiError("VALIDATION_ERROR", firstIssue(parsed.error), 400);
  const { page, limit } = parsed.data;

  // Always filter by userId: user A must never see user B's links.
  // Deleted links are hidden (soft delete keeps them in the database).
  const filter = { userId: user._id, isDeleted: false };

  // Run both queries at the same time. The index { userId: 1, createdAt: -1 }
  // on the Link model makes "my newest links" fast.
  const [links, total] = await Promise.all([
    LinkModel.find(filter)
      .sort({ createdAt: -1, _id: -1 }) // _id breaks ties so pages never repeat a link
      .skip((page - 1) * limit)
      .limit(limit),
    LinkModel.countDocuments(filter),
  ]);

  // Each link gets a `status` for the table badge (CMT-31): active, disabled,
  // expired_date or expired_clicks. The click counters are read in one call.
  const hits = await getHitsForLinks(links);
  const now = new Date();
  const result = links.map((link) => ({
    ...publicLink(link),
    status: getStatus(link, hits.get(link.code) ?? 0, now),
  }));

  return Response.json({ links: result, page, limit, total });
}

// CMT-12 added longUrl; CMT-15 adds alias (FR-04) and forceNew (FR-04b);
// CMT-32 adds expiresAt and maxClicks (FR-08).
// Title, password and QR style are added on their own days.
const createLinkSchema = z.object({
  longUrl: longUrlSchema,
  alias: aliasSchema.optional(),
  password: linkPasswordSchema,
  forceNew: z.boolean({ error: "forceNew must be true or false" }).optional(),
  expiresAt: expiresAtSchema.optional(),
  maxClicks: maxClicksSchema.optional(),
});

// Picks the error code for a failed body: the alias rules set their own code
// (INVALID_ALIAS or RESERVED_ALIAS) in `params.apiCode`.
function createErrorCode(error) {
  const issue = error.issues[0];
  if (issue?.path[0] === "longUrl") return "INVALID_URL";
  if (issue?.path[0] === "alias") return issue.params?.apiCode ?? "INVALID_ALIAS";
  return "VALIDATION_ERROR";
}

// How many new codes we try before giving up (PRD business rule 7.1).
const MAX_TRIES = 5;

// POST /api/links  { longUrl, alias?, forceNew?, expiresAt?, maxClicks? }
//   → 201 { link }                       new link (link.shortUrl is the short link)
//   → 200 { duplicate: true, existing }  logged-in user already shortened this URL
//   → 409 ALIAS_TAKEN                    someone already has this alias
//   → 401 UNAUTHORIZED                   a guest sent expiresAt or maxClicks
// Works for guests (no cookie) and for logged-in users (board tasks CMT-12, CMT-15).
export async function POST(request) {
  const parsed = createLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(createErrorCode(parsed.error), firstIssue(parsed.error), 400);
  }
  // `alias` is already lower-cased by aliasSchema, so /Geeta-Fest = /geeta-fest.
  const { longUrl, alias, password, forceNew, expiresAt, maxClicks } = parsed.data;

  // null = guest. Guest links are saved with userId: null.
  const user = await getCurrentUser();

  // Expiry and click limits are for logged-in users only (team decision, CMT-32).
  if (!user && (expiresAt !== undefined || maxClicks !== undefined)) {
    return apiError("UNAUTHORIZED", "Log in to set an expiry date or click limit", 401);
  }

  // Fields every new link gets, with or without an alias.
  // expiresAt / maxClicks stay null (= no limit) when they were not sent.
  const passwordHash = password ? await hashPassword(password) : undefined;
  const fields = {
    longUrl,
    userId: user?._id ?? null,
    createdVia: user ? "dashboard" : "guest",
    expiresAt: expiresAt ?? null,
    maxClicks: maxClicks ?? null,
    ...(passwordHash ? { passwordHash } : {}),
  };

  // getCurrentUser() only connects when there is a cookie, so connect for guests too.
  await connectDB();

  // FR-04b: a logged-in user shortening a URL they already shortened gets
  // their existing link back, so the app can ask "use existing or create new?".
  // Only their own, non-deleted links count. Guests are never checked.
  // forceNew: true means the user picked "create new", so we skip this.
  if (user && forceNew !== true) {
    const existing = await LinkModel.findOne({ userId: user._id, longUrl, isDeleted: false })
      .sort({ createdAt: -1 }); // if there are several, show the newest
    if (existing) {
      return Response.json({ duplicate: true, existing: publicLink(existing) }, { status: 200 });
    }
  }

  // Custom alias: one try only. We don't ask "is this alias free?" first,
  // because two people could both get "yes" at the same moment. We just
  // insert, and the unique index on `code` lets exactly one of them win;
  // the other gets error 11000, which we turn into 409.
  if (alias) {
    try {
      const link = await LinkModel.create({ ...fields, code: alias, isCustomAlias: true });
      return Response.json({ link: publicLink(link) }, { status: 201 });
    } catch (error) {
      if (error?.code === 11000 && error.keyPattern?.code) {
        return apiError("ALIAS_TAKEN", "This alias is already taken. Please try another one.", 409);
      }
      throw error;
    }
  }

  // No alias: make a random code. We don't check "is this code free?" before saving: two requests could both
  // see it as free and then both save it. Instead we just insert, and the
  // unique index on `code` makes MongoDB reject a clash with error 11000.
  // Then we make a new code and try again.
  let link = null;
  for (let attempt = 1; attempt <= MAX_TRIES && !link; attempt++) {
    try {
      link = await LinkModel.create({ ...fields, code: generateCode() });
    } catch (error) {
      // Only a clash on `code` is worth retrying; anything else is a real error.
      const codeClash = error?.code === 11000 && error.keyPattern?.code;
      if (!codeClash) throw error;
    }
  }

  if (!link) {
    return apiError(
      "CODE_GENERATION_FAILED",
      "Could not create a short link. Please try again.",
      500,
    );
  }

  // publicLink() is shared with GET, so both routes send links in the same shape.
  return Response.json({ link: publicLink(link) }, { status: 201 });
}
