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
});

let cached = null;

// Reads and checks process.env the first time it is called.
// It is a function (not run on import) so `npm run build` works without secrets.
export function getEnv() {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables. Check your .env.local file:\n${problems}`,
    );
  }

  cached = result.data;
  return cached;
}
