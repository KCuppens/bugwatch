import { NextRequest, NextResponse } from 'next/server';

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

type MiddlewareHandler = (request: NextRequest) => NextResponse | Response | Promise<NextResponse | Response>;
/**
 * Wrap Next.js middleware to capture errors and add breadcrumbs
 */
declare function withBugwatchMiddleware(handler: MiddlewareHandler): MiddlewareHandler;
/**
 * Create a middleware that only runs Bugwatch tracking
 * without any custom logic (useful for just adding breadcrumbs)
 */
declare function bugwatchMiddleware(): MiddlewareHandler;

export { bugwatchMiddleware, withBugwatchMiddleware };
