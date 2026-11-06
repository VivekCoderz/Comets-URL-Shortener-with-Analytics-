// Quick check that the Link model works against the real database.
// Run with:  npm run try:link
// (that runs `node --env-file=.env.local scripts/try-link.js`)
//
// It saves a test link, reads it back by code, checks that a second link with
// the same code is rejected (E11000 duplicate key), then deletes the test link.

import mongoose from "mongoose";
// Relative imports, because the "@/..." alias only works inside Next.js.
import { getEnv } from "../lib/env.js";
import { LinkModel } from "../models/Link.js";

const TEST_CODE = "try-link-test";

async function main() {
  const { MONGODB_URI } = getEnv();
  // We connect directly instead of using connectDB(), because lib/db.js
  // imports with the "@/" alias, which plain Node cannot resolve.
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log("Connected to MongoDB");

  // Build the indexes (including the unique one on `code`) before we test them.
  await LinkModel.syncIndexes();

  // Remove anything left over from an earlier run that crashed.
  await LinkModel.deleteOne({ code: TEST_CODE });

  // 1. Save a link.
  await LinkModel.create({
    code: TEST_CODE,
    longUrl: "https://example.com/some/very/long/page",
    createdVia: "guest",
  });

  // 2. Read it back by code and print it.
  const found = await LinkModel.findOne({ code: TEST_CODE }).lean();
  console.log("Saved and read back:", found);

  // 3. A second link with the same code must fail.
  try {
    await LinkModel.create({
      code: TEST_CODE,
      longUrl: "https://example.com/other",
      createdVia: "guest",
    });
    console.error("FAIL: duplicate code was saved, the unique index is missing");
    process.exitCode = 1;
  } catch (error) {
    if (error.code === 11000) {
      console.log("OK: duplicate code rejected (E11000)");
    } else {
      throw error;
    }
  }

  // 4. Clean up.
  await LinkModel.deleteOne({ code: TEST_CODE });
  console.log("Test link deleted");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
