import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";

// Upstash Redis talks over HTTP, so there is no long-lived connection to manage.
// We still create the client once and reuse it.
let client = null;

export function getRedis() {
  if (!client) {
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = getEnv();
    client = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}
