// Proves the click limit can't be beaten by many people clicking at once
// (board task CMT-30, PRD FR-08, test T8).
//
// 1. Creates a test link with maxClicks = 10.
// 2. Fires 20 visitor requests and 5 bot requests (WhatsApp preview, curl…)
//    at the same moment with Promise.all.
// 3. Checks: exactly 10 visitors reach the real URL, the other 10 get
//    /expired, and bots did not use up the limit (the Redis counter went up
//    once per visitor, 20 times, and not for the 5 bots).
// 4. Sends one more bot after the limit is reached: it must get /expired too.
// 5. Deletes the test link and its Redis keys.
//
// Needs the app running (npm run dev). Then, in a second terminal:
//   npm run try:maxclicks                       (uses http://localhost:3000)
//   npm run try:maxclicks -- https://my-app.vercel.app
//
// Note: the requests are real clicks, so they also go into the click queue
// and show up as clicks of the (deleted) test link after the next flush.

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Redis } from "@upstash/redis";
// Relative imports, because the "@/..." alias only works inside Next.js.
import { getEnv } from "../lib/env.js";
import { LinkModel } from "../models/Link.js";

const BASE_URL = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const MAX_CLICKS = 10;
const VISITORS = 20;
const BOTS = 5;

const VISITOR_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const BOT_UAS = ["WhatsApp/2.23.20.0", "facebookexternalhit/1.1", "curl/8.4.0", "Slackbot-LinkExpanding 1.0", "Googlebot/2.1"];

// Opens the short link like a browser would, but without following the
// redirect, and says where it was sent: "allowed" (the real URL) or "expired".
async function visit(code, userAgent, longUrl) {
  const response = await fetch(`${BASE_URL}/${code}`, {
    redirect: "manual",
    headers: { "user-agent": userAgent },
  });
  const location = response.headers.get("location") ?? "";
  if (location === longUrl) return "allowed";
  if (location && new URL(location, BASE_URL).pathname === "/expired") return "expired";
  return `other (${response.status} ${location})`;
}

const count = (results, value) => results.filter((result) => result === value).length;

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
  const code = `maxclicks-${randomUUID().slice(0, 8)}`;
  const longUrl = `https://example.com/maxclicks-test/${code}`;
  await LinkModel.create({ code, longUrl, maxClicks: MAX_CLICKS, createdVia: "guest" });

  let passed = false;
  try {
    console.log(`Link /${code} with maxClicks = ${MAX_CLICKS}`);
    console.log(`Sending ${VISITORS} visitors + ${BOTS} bots at the same time to ${BASE_URL} ...\n`);

    // Everyone at once. The bots are mixed in between the visitors.
    const requests = [];
    for (let i = 0; i < VISITORS; i++) {
      requests.push(visit(code, VISITOR_UA, longUrl).then((result) => ({ who: "visitor", result })));
      if (i < BOTS) {
        requests.push(visit(code, BOT_UAS[i], longUrl).then((result) => ({ who: "bot", result })));
      }
    }
    const results = await Promise.all(requests);

    const visitors = results.filter((r) => r.who === "visitor").map((r) => r.result);
    const bots = results.filter((r) => r.who === "bot").map((r) => r.result);
    const counter = Number(await redis.get(`link:hits:${code}`));
    const lateBot = await visit(code, BOT_UAS[0], longUrl);

    console.log(`Visitors sent to the real URL : ${count(visitors, "allowed")}   (expected ${MAX_CLICKS})`);
    console.log(`Visitors sent to /expired     : ${count(visitors, "expired")}   (expected ${VISITORS - MAX_CLICKS})`);
    console.log(`Bots sent to the real URL     : ${count(bots, "allowed")}    (depends on timing: bots only check the count)`);
    console.log(`Bots sent to /expired         : ${count(bots, "expired")}`);
    console.log(`Click counter in Redis        : ${counter}   (expected ${VISITORS}: one per visitor, bots not counted)`);
    console.log(`Bot after the limit           : ${lateBot}   (expected expired)`);

    const others = [...visitors, ...bots].filter((r) => r !== "allowed" && r !== "expired");
    if (others.length > 0) console.log(`Unexpected answers: ${others.join(", ")}`);

    passed =
      count(visitors, "allowed") === MAX_CLICKS &&
      count(visitors, "expired") === VISITORS - MAX_CLICKS &&
      counter === VISITORS &&
      lateBot === "expired" &&
      others.length === 0;
    console.log(passed ? "\nPASS: the limit held under parallel clicks." : "\nFAIL: see the numbers above.");
  } finally {
    // Clean up, even if something above failed.
    await LinkModel.deleteOne({ code });
    await redis.del(`link:${code}`, `link:hits:${code}`);
    await mongoose.disconnect();
  }
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
