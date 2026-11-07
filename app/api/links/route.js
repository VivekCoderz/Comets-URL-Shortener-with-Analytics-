import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { publicLink } from "@/lib/links";
import { firstIssue, listLinksQuerySchema } from "@/lib/validators";
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
