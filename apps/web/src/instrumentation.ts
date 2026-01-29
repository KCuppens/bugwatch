/**
 * Next.js Instrumentation for BugWatch
 *
 * This file enables server-side error capture for the BugWatch web app.
 * It registers the BugWatch SDK when the Node.js runtime is detected.
 */

export async function register() {
  // Only register on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerBugwatch } = await import("@bugwatch/nextjs/instrumentation");

    registerBugwatch({
      debug: process.env.NODE_ENV === "development",
      captureUncaughtExceptions: true,
      captureUnhandledRejections: true,
    });
  }
}
