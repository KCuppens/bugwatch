/**
 * Next.js Middleware helper for automatic error capture
 *
 * Usage in your middleware.ts:
 *
 * import { withBugwatchMiddleware } from '@bugwatch/nextjs/middleware';
 *
 * export const middleware = withBugwatchMiddleware((request) => {
 *   // your middleware logic
 *   return NextResponse.next();
 * });
 */

import type { NextRequest, NextResponse } from "next/server";

type MiddlewareHandler = (
  request: NextRequest
) => NextResponse | Response | Promise<NextResponse | Response>;

/**
 * Wrap Next.js middleware to capture errors and add breadcrumbs
 */
export function withBugwatchMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
  return async (request: NextRequest): Promise<NextResponse | Response> => {
    // Import dynamically to work in Edge runtime
    const { addBreadcrumb, captureException } = await import(
      "@bugwatch/core"
    );

    // Add breadcrumb for the request
    addBreadcrumb({
      category: "middleware",
      message: `${request.method} ${request.nextUrl.pathname}`,
      level: "info",
      data: {
        url: request.url,
        method: request.method,
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search || undefined,
      },
    });

    try {
      const response = await handler(request);
      return response;
    } catch (error) {
      if (error instanceof Error) {
        captureException(error, {
          tags: {
            mechanism: "nextjs-middleware",
            "http.method": request.method,
            "http.route": request.nextUrl.pathname,
          },
          request: {
            url: request.url,
            method: request.method,
            headers: sanitizeHeaders(request.headers),
          },
        });
      }

      // Re-throw to let Next.js handle the error
      throw error;
    }
  };
}

/**
 * Sanitize request headers to remove sensitive information
 */
function sanitizeHeaders(headers: Headers): Record<string, string> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "x-forwarded-for",
  ];

  const sanitized: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
}

/**
 * Create a middleware that only runs Bugwatch tracking
 * without any custom logic (useful for just adding breadcrumbs)
 */
export function bugwatchMiddleware(): MiddlewareHandler {
  return withBugwatchMiddleware(async () => {
    const { NextResponse } = await import("next/server");
    return NextResponse.next();
  });
}
