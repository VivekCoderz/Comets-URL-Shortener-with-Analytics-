// Proves the daily link limit can't be beaten by sending many creates at once
// (board task CMT-42, PRD FR-11, test T11).
//
// 1. Signs up a fresh test user through the real API (limit: 50 links a day).
// 2. Sends 3 creates with a bad URL first. They must fail with 400 and must
//    NOT use up any of today's links.
// 3. Fires 60 creates at the same moment with Promise.all.
// 4. Checks: exactly 50 get 201 and 10 get 429 DAILY_LIMIT_REACHED (with the
//    X-RateLimit-* and Retry-After headers), MongoDB has exactly 50 links for
//    the user, and the Redis counter says 50.
// 5. Deletes the test user, their links and the Redis counter.
//
// Needs the app running (npm run dev). Then, in a second terminal:
//   npm run try:limit                        (uses http://localhost:3000)
//   npm run try:limit -- https://my-app.vercel.app

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Redis } from "@upstash/redis";
// Relative imports, because the "@/..." alias only works inside Next.js.
import { getEnv } from "../lib/env.js";
import { istDay } from "../lib/time.js";
import { LinkModel } from "../models/Link.js";
import { UserModel } from "../models/User.js";

const BASE_URL = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const PARALLEL = 60;
const BAD_REQUESTS = 3;

// Signs up and returns the login cookie ("name=value") to send with each create.
async function signUp(email) {
  const response = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: `Limit-test-${randomUUID()}`, name: "Limit test" }),
  });
  const body = await response.json();
  if (response.status !== 201) throw new Error(`Sign-up failed: ${response.status} ${JSON.stringify(body)}`);
  // "comets_session=eyJ...; Path=/; HttpOnly; ..." → keep only "name=value".
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Sign-up did not set a login cookie");
  return { cookie, user: body.user };
}

// One POST /api/links as the test user. Returns the status and the headers we check.
async function createLink(cookie, longUrl) {
  const response = await fetch(`${BASE_URL}/api/links`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ longUrl }),
  });
  const body = await response.json();
  return {
    status: response.status,
    code: body.error?.code ?? null,
    limit: response.headers.get("x-ratelimit-limit"),
    remaining: response.headers.get("x-ratelimit-remaining"),
    retryAfter: response.headers.get("retry-after"),
  };
}

const count = (results, status) => results.filter((result) => result.status === status).length;

async function main() {
  const { MONGODB_URI, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = getEnv();
  const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });

  // Is the app running?
  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    console.error(`Can't reach ${BASE_URL}. Start the app first with: npm run dev`);
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const tag = randomUUID().slice(0, 8);
  const { cookie, user } = await signUp(`limit-${tag}@comets-test.dev`);
  const limit = user.dailyLinkLimit;
  // Same key as takeDailyLink() in lib/rateLimit.js.
  const counterKey = `rl:create:${user.id}:${istDay()}`;

  let passed = false;
  try {
    console.log(`Test user ${user.email}, daily limit = ${limit}`);

    // Step 2: requests that fail validation must not use up the limit.
    const bad = await Promise.all(
      Array.from({ length: BAD_REQUESTS }, () => createLink(cookie, "not a url")),
    );
    const counterAfterBad = Number((await redis.get(counterKey)) ?? 0);
    console.log(`\n${BAD_REQUESTS} creates with a bad URL : ${bad.map((r) => r.status).join(", ")}   (expected 400 each)`);
    console.log(`Counter after bad creates  : ${counterAfterBad}   (expected 0: nothing used up)`);

    // Step 3: everyone at once. Each URL is different, so none is a duplicate.
    console.log(`\nSending ${PARALLEL} creates at the same time to ${BASE_URL} ...\n`);
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => createLink(cookie, `https://example.com/limit-test/${tag}/${i}`)),
    );

    const created = count(results, 201);
    const refused = results.filter((r) => r.status === 429);
    const others = results.filter((r) => r.status !== 201 && r.status !== 429);
    // Every 429 must be the daily limit and carry the headers API clients rely on.
    const headersOk = refused.every(
      (r) => r.code === "DAILY_LIMIT_REACHED" && r.limit === String(limit) && r.remaining === "0" && Number(r.retryAfter) > 0,
    );
    const linksInDb = await LinkModel.countDocuments({ userId: user.id });
    const counter = Number((await redis.get(counterKey)) ?? 0);

    console.log(`201 Created               : ${created}   (expected ${limit})`);
    console.log(`429 DAILY_LIMIT_REACHED   : ${refused.length}   (expected ${PARALLEL - limit})`);
    console.log(`429s have rate-limit headers : ${headersOk ? "yes" : "NO"}`);
    if (!headersOk) {
      // Show what each 429 sent, so it's clear which check refused it.
      for (const r of refused) {
        console.log(`   429 ${r.code}  limit=${r.limit} remaining=${r.remaining} retry-after=${r.retryAfter}`);
      }
    }
    console.log(`Links saved in MongoDB    : ${linksInDb}   (expected ${limit})`);
    console.log(`Redis counter             : ${counter}   (expected ${limit})`);
    if (others.length > 0) console.log(`Unexpected answers: ${others.map((r) => `${r.status} ${r.code}`).join(", ")}`);

    passed =
      bad.every((r) => r.status === 400) &&
      counterAfterBad === 0 &&
      created === limit &&
      refused.length === PARALLEL - limit &&
      headersOk &&
      linksInDb === limit &&
      counter === limit &&
      others.length === 0;
    console.log(passed ? "\nPASS: exactly the daily limit got through." : "\nFAIL: see the numbers above.");
  } finally {
    // Clean up, even if something above failed.
    await LinkModel.deleteMany({ userId: user.id });
    await UserModel.deleteOne({ _id: user.id });
    await redis.del(counterKey);
    await mongoose.disconnect();
  }
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
