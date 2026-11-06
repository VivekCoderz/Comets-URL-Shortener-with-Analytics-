import { connectDB } from "@/lib/db";
import { checkPassword, createToken, hashPassword, publicUser, setAuthCookie } from "@/lib/auth";
import { apiError, readJson } from "@/lib/errors";
import { firstIssue, loginSchema } from "@/lib/validators";
import { UserModel } from "@/models/User";

// Same message for "no such email" and "wrong password", so nobody can use
// the login form to find out which emails have accounts (PRD FR-02).
const INVALID = "Invalid email or password";

// A hash to compare against when the email doesn't exist, so a wrong email
// takes as long as a wrong password (no timing hint either).
let dummyHash;

// POST /api/auth/login  { email, password }  →  200 { user } + cookie
export async function POST(request) {
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION_ERROR", firstIssue(parsed.error), 400);
  const { email, password } = parsed.data;

  await connectDB();
  // passwordHash has `select: false` in the model, so we ask for it here only.
  const user = await UserModel.findOne({ email }).select("+passwordHash");

  dummyHash ??= await hashPassword("not-a-real-password");
  const ok = await checkPassword(password, user?.passwordHash ?? dummyHash);
  if (!user || !ok || user.status !== "active") {
    return apiError("INVALID_CREDENTIALS", INVALID, 401);
  }

  user.lastLoginAt = new Date();
  await user.save();

  await setAuthCookie(await createToken(user._id));
  return Response.json({ user: publicUser(user) });
}
