import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

// On Vercel every request can run in a new function call, and in development
// hot reload re-runs this file. Without a cache we would open a new MongoDB
// connection each time and soon hit the Atlas connection limit.
// So we keep one connection (or one connection attempt) on `globalThis`.
const cache =
  globalThis.mongooseCache ?? (globalThis.mongooseCache = { conn: null, promise: null });

export async function connectDB() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const { MONGODB_URI } = getEnv();
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false, // fail fast instead of waiting when not connected
      serverSelectionTimeoutMS: 5000,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null; // let the next request try again
    throw error;
  }

  return cache.conn;
}
