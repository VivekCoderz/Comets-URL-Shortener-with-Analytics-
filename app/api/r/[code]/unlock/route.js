import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { apiError, readJson } from "@/lib/errors";
import { LinkModel } from "@/models/Link";
import { z } from "zod";

const unlockSchema = z.object({
  password: z.string({ error: "Password is required" }).trim().min(1, "Password is required"),
});

export async function POST(request, { params }) {
  const { code } = await params;
  const parsed = unlockSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid password", 400);
  }

  await connectDB();
  const link = await LinkModel.findOne({ code: String(code).toLowerCase(), isDeleted: false }).select(
    "+passwordHash",
  );
  if (!link || !link.passwordHash) {
    return apiError("NOT_FOUND", "Link not found", 404);
  }

  const ok = await bcrypt.compare(parsed.data.password, link.passwordHash);
  if (!ok) {
    return apiError("INVALID_PASSWORD", "Wrong password", 401);
  }

  return NextResponse.redirect(new URL(link.longUrl, request.url), 302);
}
