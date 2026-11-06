import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests use the same secrets as `npm run dev`, so load .env.local if it exists.
// (Next.js does this for the app; Vitest does not, so we do it here.)
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    // Same "@/..." imports as the app (see jsconfig.json).
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // Test files share one MongoDB database, so run them one after another.
    fileParallelism: false,
    // Atlas (free tier) can be slow to answer the first query.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
