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

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("access_token")?.value;
  if (!token) return false;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // No secret available in Edge Runtime — fall back to presence check.
    return true;
  }

  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const valid = await hasValidSession(req);
    if (!valid) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (GUEST_PREFIXES.some((p) => pathname.startsWith(p))) {
    const valid = await hasValidSession(req);
    if (valid) {
      const { searchParams } = req.nextUrl;
      const next = searchParams.get("next") ?? "/dashboard";
      const SAFE_PATH_RE = /^\/[a-zA-Z0-9_\-./]*$/
      const safeNext = next && SAFE_PATH_RE.test(next) ? next : '/dashboard';
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
