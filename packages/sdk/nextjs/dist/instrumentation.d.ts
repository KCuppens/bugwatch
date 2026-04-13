/**
 * Server instrumentation helper for Next.js
 *
 * Usage in your instrumentation.ts:
 *
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { registerBugwatch } = await import('@bugwatch/nextjs/instrumentation');
 *     registerBugwatch();
 *   }
 * }
 */
interface RegisterOptions {
    /** Override the runtime detection */
    runtime?: "nodejs" | "edge";
    /** API key (overrides environment variable) */
    apiKey?: string;
    /** API endpoint (overrides environment variable) */
    endpoint?: string;
    /** Enable debug logging */
    debug?: boolean;
    /** Capture uncaught exceptions */
    captureUncaughtExceptions?: boolean;
    /** Capture unhandled promise rejections */
    captureUnhandledRejections?: boolean;
    /** Capture errors logged via console.error as warning-level events (default: true) */
    captureConsoleErrors?: boolean;
}
/**
 * Reset the SDK registration state.
 * Use this for testing or to allow re-registration.
 */
declare function reset(): void;
/**
 * Register Bugwatch in Next.js instrumentation.ts
 *
 * Call this in your project's instrumentation.ts file
 * to enable server-side error tracking.
 */
declare function registerBugwatch(options?: RegisterOptions): void;
/**
 * Check if Bugwatch has been registered
 */
declare function isRegistered(): boolean;
/**
 * Next.js App Router onRequestError hook (Next.js 15+)
 *
 * Captures server-side errors from Server Components, route handlers,
 * server actions, and middleware that Next.js catches internally
 * (these never reach process.on('uncaughtException')).
 *
 * Usage in your instrumentation.ts:
 *
 * ```ts
 * export { onRequestError } from '@bugwatch/nextjs/instrumentation';
 *
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { registerBugwatch } = await import('@bugwatch/nextjs/instrumentation');
 *     registerBugwatch();
 *   }
 * }
 * ```
 */
declare function onRequestError(err: {
    digest?: string;
} & Error, request: {
    path: string;
    method: string;
    headers: Record<string, string>;
}, context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "page" | "route" | "action" | "middleware";
    renderSource?: "react-server-components" | "react-server-components-payload" | "server-rendering";
}): Promise<void>;

export { type RegisterOptions, isRegistered, onRequestError, registerBugwatch, reset };
