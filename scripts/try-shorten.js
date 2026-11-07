// T1 check for POST /api/links: 100 guests click "Shorten" at the same moment.
// Expected: 100 links, 100 different codes, all saved with userId: null.
//
// 1. Start the app in one terminal:   npm run dev
// 2. Run this in another terminal:    npm run try:shorten
//    (that runs `node --env-file=.env.local scripts/try-shorten.js`)
//
// At the end it deletes the 100 test links again.

import mongoose from "mongoose";
// Relative imports, because the "@/..." alias only works inside Next.js.
import { getEnv } from "../lib/env.js";
import { LinkModel } from "../models/Link.js";

const COUNT = 100;
const APP_URL = "http://localhost:3000"; // where `npm run dev` runs

async function shortenOne(i) {
  // No cookie is sent, so the route treats every request as a guest.
  const res = await fetch(`${APP_URL}/api/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ longUrl: `https://example.com/t1-test/${i}` }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  // 1. Send all 100 requests at the same time.
  const results = await Promise.all(Array.from({ length: COUNT }, (_, i) => shortenOne(i)));

  const failed = results.filter((r) => r.status !== 201);
  const codes = results.filter((r) => r.status === 201).map((r) => r.body.link.code);
  const unique = new Set(codes);

  console.log(`Created: ${codes.length} of ${COUNT}`);
  console.log(`Different codes: ${unique.size}`);
  if (failed.length > 0) {
    console.error("FAIL: some requests did not return 201, first one:", failed[0]);
    process.exitCode = 1;
  }
  if (unique.size !== codes.length) {
    console.error("FAIL: two links got the same code");
    process.exitCode = 1;
  }

  // 2. Check in the database that guest links have userId: null, then clean up.
  await mongoose.connect(getEnv().MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    const saved = await LinkModel.find({ code: { $in: codes } }).lean();
    const notGuest = saved.filter((link) => link.userId !== null || link.createdVia !== "guest");
    if (saved.length !== codes.length || notGuest.length > 0) {
      console.error("FAIL: not every link was saved as a guest link (userId: null)");
      process.exitCode = 1;
    } else {
      console.log("OK: all links saved with userId: null and createdVia: 'guest'");
    }

    await LinkModel.deleteMany({ code: { $in: codes } });
    console.log("Test links deleted");
  } finally {
    await mongoose.disconnect();
  }

  if (!process.exitCode) console.log("PASS: T1");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
