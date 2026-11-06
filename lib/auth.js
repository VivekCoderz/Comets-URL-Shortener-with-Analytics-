import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";

// How login works:
// 1. On sign-up/login we create a JWT (a signed token) that says "this is user <id>".
// 2. We put it in an httpOnly cookie. JavaScript in the browser can't read it,
//    so a hacked script on the page can't steal it.
// 3. On every request the browser sends the cookie back; we verify the
//    signature with JWT_SECRET. If someone edits the token, the check fails.

export const AUTH_COOKIE = "token";
const TOKEN_DAYS = 7;
const BCRYPT_ROUNDS = 10; // higher = slower to guess, but also slower to log in

// ---- Passwords ----------------------------------------------------------
export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ---- JWT ----------------------------------------------------------------
function secretKey() {
  return new TextEncoder().encode(getEnv().JWT_SECRET);
}

export function createToken(userId) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId)) // "sub" = which user this token belongs to
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_DAYS}d`)
    .sign(secretKey());
}

// Returns the user id from a valid token, or null if it is missing, edited or expired.
export async function readToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ---- Cookie ---------------------------------------------------------------
export async function setAuthCookie(token) {
  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true, // browser JavaScript can't read it
    secure: process.env.NODE_ENV === "production", // HTTPS only on the live site
    sameSite: "lax", // not sent on cross-site form posts (CSRF protection)
    path: "/",
    maxAge: TOKEN_DAYS * 24 * 60 * 60, // seconds
  });
}

export async function clearAuthCookie() {
  (await cookies()).delete(AUTH_COOKIE);
}

// ---- Current user -----------------------------------------------------------
// The logged-in user, or null for guests. Never throws, so any route can use it.
export async function getCurrentUser() {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const userId = await readToken(token);
  if (!userId) return null;

  await connectDB();
  const user = await UserModel.findById(userId).catch(() => null);
  if (!user || user.status !== "active") return null;
  return user;
}

// What we send to the browser. Never the password hash.
export function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name ?? null,
    plan: user.plan,
    dailyLinkLimit: user.dailyLinkLimit,
    createdAt: user.createdAt,
  };
}
