import { errors, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export async function proxy(request) {
  const token = request.cookies.get("token")?.value;
  const redirectToLogin = () =>
    NextResponse.redirect(new URL("/login", request.url));

  if (!token) return redirectToLogin();

  const secret = new TextEncoder().encode(getEnv().JWT_SECRET);
  let payload;

  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] }));
  } catch (error) {
    if (error instanceof errors.JOSEError) return redirectToLogin();
    throw error;
  }

  if (!payload.sub) return redirectToLogin();
  return NextResponse.next();
}

export const config = {
  matcher: "/dashboard/:path*",
};
