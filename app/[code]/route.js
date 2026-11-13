import { randomUUID } from "node:crypto";
import { after, connection, NextResponse } from "next/server";
import { pushClickEvent } from "@/lib/clicks";
import { connectDB } from "@/lib/db";
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

function clickEvent(request, link, clickedAt) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

  return {
    eventId: randomUUID(),
    linkId: link.id,
    time: clickedAt.toISOString(),
    ip,
    ua: request.headers.get("user-agent") || "",
    referrer: request.headers.get("referer") || "",
    country: request.headers.get("x-vercel-ip-country") || "Unknown",
    source: new URL(request.url).searchParams.get("src") === "qr" ? "qr" : "link",
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

// One log line per redirect (CMT-18), e.g.
//   [redirect] path=/geeta-fest status=302 ms=14 cache=hit
// so slow redirects and the cache hit rate show up in the Vercel logs.
export async function GET(request, { params }) {
  const start = performance.now();
  const result = { cache: "miss" }; // redirect() sets "hit" when Redis had the link
  const response = await redirect(request, params, result);

  const ms = Math.round(performance.now() - start);
  const path = new URL(request.url).pathname;
  console.info(`[redirect] path=${path} status=${response.status} ms=${ms} cache=${result.cache}`);
  return response;
}

async function redirect(request, params, result) {
  await connection();

  const { code: rawCode } = await params;
  const parsedCode = codeSchema.safeParse(rawCode);
  if (!parsedCode.success) return linkNotFound(request);

  const code = parsedCode.data.toLowerCase();
  // null when the link isn't cached OR Redis is down (lib/linkCache.js logs a
  // warning then); both cases read the link from MongoDB below.
  let link = await getCachedLink(code);

  if (link !== null && link !== undefined) {
    result.cache = "hit";
    if (link === MISSING_LINK) return linkNotFound(request);
  } else {
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
    const hits = await incrementLinkHits(code); // null if Redis is down: not blocked
    if (hits !== null && hits > link.maxClicks) return expiredRedirect(request);
  }

  if (link.hasPassword) {
    return NextResponse.redirect(new URL(`/p/${code}`, request.url), 302);
  }

  const clickedAt = new Date();
  const event = clickEvent(request, link, clickedAt);
  after(() => pushClickEvent(event));

  return NextResponse.redirect(link.url, 302);
}
