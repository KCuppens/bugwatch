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

export { type RegisterOptions, isRegistered, registerBugwatch, reset };
