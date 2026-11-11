import { createHmac, randomUUID } from "node:crypto";
import { after, connection, NextResponse } from "next/server";
import { pushClickEvent } from "@/lib/clicks";
import { connectDB } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  cacheMissingLink,
  cacheRedirectLink,
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
    // The flush (lib/clicks.js, CMT-22) reads the redirect time from `time`.
    time: clickedAt.toISOString(),
    clickedAt: clickedAt.toISOString(),
    visitorHash,
    // Raw user-agent, so the enrichment step (CMT-24) can find device, browser and bots.
    userAgent,
    country: request.headers.get("x-vercel-ip-country") || "Unknown",
    referrer: referrer && URL.canParse(referrer) ? new URL(referrer).hostname : "",
    source: "link",
    isBot: false,
    isRefresh: false,
  };
}

// Unknown or deleted code: show the "Link not found" page (CMT-19).
// That page calls notFound(), so the browser gets the 404 page and a 404 status.
function linkNotFound(request) {
  return NextResponse.redirect(new URL("/link-not-found", request.url), 302);
}

function expiredRedirect(request) {
  return NextResponse.redirect(new URL("/expired", request.url), 302);
}

export async function GET(request, { params }) {
  await connection();

  const { code: rawCode } = await params;
  const parsedCode = codeSchema.safeParse(rawCode);
  if (!parsedCode.success) return linkNotFound(request);

  const code = parsedCode.data.toLowerCase();
  let link = await getCachedLink(code);

  if (link !== null && link !== undefined) {
    console.info(`[redirect] cache=hit code=${code}`);
    if (link === MISSING_LINK) return linkNotFound(request);
  } else {
    console.info(`[redirect] cache=miss code=${code}`);
    await connectDB();
    const document = await LinkModel.findOne({ code, isDeleted: false }).select(
      "+passwordHash",
    );

    if (!document) {
      await cacheMissingLink(code);
      return linkNotFound(request);
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
  after(() => pushClickEvent(clickEvent(request, link, clickedAt)));

  return NextResponse.redirect(link.url, 302);
}
