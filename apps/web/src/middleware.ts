import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Server-side route protection.
 *
 * Protected routes (/welcome, /dashboard) require the httpOnly `access_token`
 * cookie set by the Rust auth API. If absent, redirect to /login so the user
 * never sees a flash of protected content before the client-side AuthGuard fires.
 *
 * Auth routes (/login, /signup, /forgot-password) redirect to /dashboard when
 * the user is already authenticated, mirroring the client-side GuestGuard.
 *
 * Note: httpOnly cookies are visible to middleware (server-side) even though
 * client-side JS cannot access them.
 */

const PROTECTED_PREFIXES = ["/welcome", "/dashboard", "/overview"];
const GUEST_PREFIXES = ["/login", "/signup", "/forgot-password"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("access_token");

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!hasSession) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (GUEST_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/welcome/:path*",
    "/dashboard/:path*",
    "/overview/:path*",
    "/overview",
    "/login",
    "/signup",
    "/forgot-password",
  ],
};
