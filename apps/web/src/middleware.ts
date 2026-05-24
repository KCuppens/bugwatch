import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Server-side route protection.
 *
 * Protected routes (/welcome, /dashboard) require a valid, cryptographically
 * verified `access_token` httpOnly cookie. Checking the signature in middleware
 * (Edge Runtime, via jose) prevents unsigned/expired cookies from seeing the
 * protected page HTML shell before the client-side AuthGuard fires.
 *
 * Requires JWT_SECRET env var to be available in the Edge Runtime.
 * If JWT_SECRET is absent, middleware falls back to cookie-presence check so the
 * app keeps working during local dev without the env var set.
 *
 * Auth routes (/login, /signup, /forgot-password) redirect to /dashboard when
 * the user is already authenticated, mirroring the client-side GuestGuard.
 */

const PROTECTED_PREFIXES = ["/welcome", "/dashboard", "/overview"];
const GUEST_PREFIXES = ["/login", "/signup", "/forgot-password"];

/**
 * Returns "verified" when the JWT signature and expiry are confirmed,
 * "cookie_present" when the cookie exists but can't be verified (JWT_SECRET
 * absent in Edge Runtime), or "none" when no cookie exists or the token is
 * cryptographically invalid.
 */
async function checkSession(req: NextRequest): Promise<"verified" | "cookie_present" | "none"> {
  const token = req.cookies.get("access_token")?.value;
  if (!token) return "none";

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // JWT_SECRET not reachable in this Edge Runtime instance.
    // Treat as unverified-but-present — the client-side AuthGuard does the real check.
    return "cookie_present";
  }

  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return "verified";
  } catch {
    return "none";
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    // Allow if cookie exists (verified OR unverified). The client-side AuthGuard
    // handles the real auth check and redirects to /login on a 401.
    const status = await checkSession(req);
    if (status === "none") {
      const loginUrl = new URL("/login", req.url);
      // Only persist the pathname as `next` if it is a same-origin path with
      // no traversal sequences. Regex char classes that include `.` can let
      // `..` through, so reject any path containing `..` explicitly.
      const isSafeNext = pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes("..");
      if (isSafeNext) {
        loginUrl.searchParams.set("next", pathname);
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  if (GUEST_PREFIXES.some((p) => pathname.startsWith(p))) {
    // ONLY redirect to /dashboard when the session is cryptographically VERIFIED.
    // Using cookie-presence here causes an infinite redirect loop: stale httpOnly
    // cookies (which JS cannot clear) make every /login visit bounce to /dashboard,
    // which then bounces back to /login because the server rejects the expired token.
    const status = await checkSession(req);
    if (status === "verified") {
      const { searchParams } = req.nextUrl;
      const next = searchParams.get("next") ?? "/dashboard";
      const SAFE_PATH_RE = /^\/[a-zA-Z0-9_\-./]*$/;
      const safeNext = next && SAFE_PATH_RE.test(next) ? next : "/dashboard";
      return NextResponse.redirect(new URL(safeNext, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/welcome",
    "/welcome/:path*",
    "/dashboard/:path*",
    "/overview/:path*",
    "/overview",
    "/login",
    "/signup",
    "/forgot-password",
  ],
};
