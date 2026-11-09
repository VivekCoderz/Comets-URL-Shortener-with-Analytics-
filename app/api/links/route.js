import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { generateCode } from "@/lib/codeGen";
import { connectDB } from "@/lib/db";
import { apiError, readJson } from "@/lib/errors";
import { publicLink } from "@/lib/links";
import {
  customAliasSchema,
  firstIssue,
  listLinksQuerySchema,
  longUrlSchema,
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

  return Response.json({ links: links.map(publicLink), page, limit, total });
}

const createLinkSchema = z.object({
  longUrl: longUrlSchema,
  alias: customAliasSchema.optional(),
});

// How many new codes we try before giving up (PRD business rule 7.1).
const MAX_TRIES = 5;

// POST /api/links  { longUrl, alias? }  →  201 { link }
// Works for guests (no cookie) and for logged-in users (board task CMT-12).
export async function POST(request) {
  const parsed = createLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const errorCode = parsed.error.issues[0]?.path[0] === "alias" ? "INVALID_ALIAS" : "INVALID_URL";
    return apiError(errorCode, firstIssue(parsed.error), 400);
  }
  const { longUrl, alias } = parsed.data;

  // null = guest. Guest links are saved with userId: null.
  const user = await getCurrentUser();

  // getCurrentUser() only connects when there is a cookie, so connect for guests too.
  await connectDB();

  // We don't check "is this code free?" before saving: two requests could both
  // see it as free and then both save it. Instead we just insert, and the
  // unique index on `code` makes MongoDB reject a clash with error 11000.
  // Then we make a new code and try again.
  let link = null;
  for (let attempt = 1; attempt <= MAX_TRIES && !link; attempt++) {
    try {
      link = await LinkModel.create({
        code: alias ?? generateCode(),
        longUrl,
        userId: user?._id ?? null,
        createdVia: user ? "dashboard" : "guest",
        isCustomAlias: Boolean(alias),
      });
    } catch (error) {
      // Only a clash on `code` is worth retrying; anything else is a real error.
      const codeClash =
        error?.code === 11000 && (error.keyPattern?.code || error.keyValue?.code);
      if (!codeClash) throw error;
      if (alias) {
        return apiError("ALIAS_TAKEN", "This alias is already in use", 409);
      }
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
