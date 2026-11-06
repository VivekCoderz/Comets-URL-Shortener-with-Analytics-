import { z } from "zod";

// Input rules shared by the pages (browser) and the route handlers (server).
// This file must stay free of server-only code so forms can import it too.

// " Riya@Mail.com " and "riya@mail.com" are the same account:
// trim spaces, lower-case, then check it looks like an email.
const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }));

const password = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters"); // bcrypt only uses the first 72 bytes

export const signupSchema = z.object({
  email,
  password,
  name: z.string().trim().max(60, "Name must be at most 60 characters").optional(),
});

export const loginSchema = z.object({
  email,
  // On login we don't repeat the length rule: a wrong password is just "invalid".
  password: z.string({ error: "Password is required" }).min(1, "Password is required"),
});

// Turns a Zod error into one short message for the user.
export function firstIssue(error) {
  return error.issues[0]?.message ?? "Invalid input";
}
