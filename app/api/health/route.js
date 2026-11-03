import { connection } from "next/server";
import { connectDB } from "@/lib/db";
import { getRedis } from "@/lib/redis";

// Runs one check, measures how long it took and never throws.
async function check(fn) {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, ms: Date.now() - start, error: message };
  }
}

// GET /api/health → is the app able to reach MongoDB and Redis?
export async function GET() {
  // Cache Components is on in this project, so Next.js would try to
  // prerender this route at build time. connection() tells Next.js:
  // "run this only when a real request comes in".
  await connection();

  const [mongodb, redis] = await Promise.all([
    check(async () => {
      const db = await connectDB();
      await db.connection.db?.admin().ping();
    }),
    check(() => getRedis().ping()),
  ]);

  const ok = mongodb.ok && redis.ok;

  return Response.json(
    { status: ok ? "ok" : "error", mongodb, redis, time: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
