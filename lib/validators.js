import { z } from "zod";
import { getEnv } from "@/lib/env";
import { isReserved } from "@/lib/reserved";

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

export const longUrlSchema = z
  .string({ error: "URL is required" })
  .trim()
  .max(2048, "URL must be at most 2,048 characters")
  .superRefine((value, context) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a valid URL" });
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "URL must use http or https" });
      return;
    }

    const baseUrl = new URL(getEnv({ publicOnly: true }).NEXT_PUBLIC_BASE_URL);
    if (url.host === baseUrl.host) {
      context.addIssue({ code: "custom", message: "URL cannot point to this shortener" });
    }
  });

export const customAliasSchema = z
  .string({ error: "Alias must be a string" })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Alias can contain only letters, numbers, and hyphens")
  .refine((value) => !isReserved(value), "This alias is reserved");

// Query string for GET /api/links: ?page=1&limit=20
// Values in a URL are always text, so z.coerce turns "2" into the number 2.
export const listLinksQuerySchema = z.object({
  page: z.coerce.number().int("page must be a whole number").min(1, "page must be 1 or more").default(1),
  limit: z.coerce
    .number()
    .int("limit must be a whole number")
    .min(1, "limit must be 1 or more")
    .max(100, "limit must be 100 or less")
    .default(20),
});

// Body for PATCH /api/links/[id] (CMT-15). Every field is optional, but at least
// one must be sent. The short code itself can never be changed (PRD rule 7.11).
// Expiry (CMT-32) and password (CMT-44) are added to this schema on their days.
export const editLinkSchema = z
  .object({
    longUrl: longUrlSchema.optional(),
    // "" or null removes the title.
    title: z
      .string()
      .trim()
      .max(100, "Title must be at most 100 characters")
      .nullable()
      .optional()
      .transform((value) => (value === "" ? null : value)),
    isActive: z.boolean({ error: "isActive must be true or false" }).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one of: longUrl, title, isActive",
  });

// Turns a Zod error into one short message for the user.
export function firstIssue(error) {
  return error.issues[0]?.message ?? "Invalid input";
}
