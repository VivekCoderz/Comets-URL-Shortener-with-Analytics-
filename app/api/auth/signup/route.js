import { connectDB } from "@/lib/db";
import { createToken, hashPassword, publicUser, setAuthCookie } from "@/lib/auth";
import { apiError, readJson } from "@/lib/errors";
import { firstIssue, signupSchema } from "@/lib/validators";
import { UserModel } from "@/models/User";

// POST /api/auth/signup  { email, password, name? }  →  201 { user }
// Creates the account and logs the user in (sets the cookie).
export async function POST(request) {
  const parsed = signupSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION_ERROR", firstIssue(parsed.error), 400);
  const { email, password, name } = parsed.data;

  await connectDB();
  let user;
  try {
    user = await UserModel.create({ email, name, passwordHash: await hashPassword(password) });
  } catch (error) {
    // 11000 = MongoDB "duplicate key": the unique index on email already has it.
    // We rely on the index instead of "find first, then create", because two
    // sign-ups with the same email at the same moment could both pass a find.
    if (error?.code === 11000) {
      return apiError("EMAIL_TAKEN", "This email is already registered", 409);
    }
    throw error;
  }

  await setAuthCookie(await createToken(user._id));
  return Response.json({ user: publicUser(user) }, { status: 201 });
}
