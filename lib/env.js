import { z } from "zod";

// Every environment variable the server needs, in one place.
// Add new variables here (and in .env.example) when a feature needs them.
const envSchema = z.object({
  MONGODB_URI: z.string({ error: "is missing" }).min(1, "is empty"),
  UPSTASH_REDIS_REST_URL: z.url({ error: "is missing or is not a valid URL" }),
  UPSTASH_REDIS_REST_TOKEN: z.string({ error: "is missing" }).min(1, "is empty"),
  NEXT_PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  // Signs the login cookie (JWT). Must be long so nobody can guess it.
  JWT_SECRET: z.string({ error: "is missing" }).min(32, "must be at least 32 characters"),
  // Shared secret the scheduler sends to POST /api/cron/flush-clicks (CMT-23).
  // Optional so the rest of the app still runs without it; the flush route
  // refuses every call until it is set.
  CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
  // Salt for the visitor hash, SHA-256(IP + user-agent + salt + IST date) (CMT-24).
  // Secret, so nobody can rebuild a visitor's IP from the hash.
  VISITOR_HASH_SALT: z.string({ error: "is missing" }).min(32, "must be at least 32 characters"),
});
const publicEnvSchema = envSchema.pick({ NEXT_PUBLIC_BASE_URL: true });

// Reads and checks environment variables only when requested, so builds work without secrets.
// Public-only access lets shared validators run without requiring server credentials.
// We intentionally re-read `process.env` on each call so tests and runtime config changes
// cannot get stuck behind stale cached values.
export function getEnv({ publicOnly = false } = {}) {
  if (publicOnly) {
    const result = publicEnvSchema.safeParse({
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    });
    if (!result.success) {
      const problems = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`Invalid public environment variables:\n${problems}`);
    }

    return result.data;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables. Check your .env.local file:\n${problems}`,
    );
  }

  return result.data;
}
