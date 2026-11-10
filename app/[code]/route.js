import { createHmac, randomUUID } from "node:crypto";
import { after, connection, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  cacheMissingLink,
  cacheRedirectLink,
  enqueueClick,
  getCachedLink,
  incrementLinkHits,
  MISSING_LINK,
} from "@/lib/linkCache";
import { LinkModel } from "@/models/Link";
import { z } from "zod";

const codeSchema = z.string().min(1);

function istDate(date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clickEvent(request, link, clickedAt) {
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedIp || request.headers.get("x-real-ip") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const visitorHash = createHmac("sha256", getEnv().JWT_SECRET)
    .update(`${ip}${userAgent}${istDate(clickedAt)}`)
    .digest("hex");
  const referrer = request.headers.get("referer");

  return {
    eventId: randomUUID(),
    linkId: link.id,
    userId: link.userId,
    clickedAt: clickedAt.toISOString(),
    visitorHash,
    country: request.headers.get("x-vercel-ip-country") || "Unknown",
    referrer: referrer && URL.canParse(referrer) ? new URL(referrer).hostname : "",
    source: "link",
    isBot: false,
    isRefresh: false,
  };
}

function expiredRedirect(request) {
  return NextResponse.redirect(new URL("/expired", request.url), 302);
}

export async function GET(request, { params }) {
  await connection();

  const { code: rawCode } = await params;
  const parsedCode = codeSchema.safeParse(rawCode);
  if (!parsedCode.success) return new Response(null, { status: 404 });

  const code = parsedCode.data.toLowerCase();
  let link = await getCachedLink(code);

  if (link !== null && link !== undefined) {
    console.info(`[redirect] cache=hit code=${code}`);
    if (link === MISSING_LINK) return new Response(null, { status: 404 });
  } else {
    console.info(`[redirect] cache=miss code=${code}`);
    await connectDB();
    const document = await LinkModel.findOne({ code, isDeleted: false }).select(
      "+passwordHash",
    );

    if (!document) {
      await cacheMissingLink(code);
      return new Response(null, { status: 404 });
    }

    link = {
      id: String(document._id),
      userId: document.userId ? String(document.userId) : null,
      url: document.longUrl,
      active: document.isActive,
      expiresAt: document.expiresAt?.toISOString() ?? null,
      maxClicks: document.maxClicks,
      hasPassword: Boolean(document.passwordHash),
    };
    await cacheRedirectLink(code, link);
  }

  if (!link.active || (link.expiresAt && Date.parse(link.expiresAt) <= Date.now())) {
    return expiredRedirect(request);
  }

  if (link.maxClicks !== null && link.maxClicks !== undefined) {
    const hits = await incrementLinkHits(code);
    if (hits > link.maxClicks) return expiredRedirect(request);
  }

  if (link.hasPassword) {
    return NextResponse.redirect(new URL(`/p/${code}`, request.url), 302);
  }

  const clickedAt = new Date();
  after(() => enqueueClick(clickEvent(request, link, clickedAt)));

  return NextResponse.redirect(link.url, 302);
}
