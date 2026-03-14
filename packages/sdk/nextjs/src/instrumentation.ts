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

import { getEnvConfig } from "./config";

export interface RegisterOptions {
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

const DEFAULT_OPTIONS: RegisterOptions = {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  captureConsoleErrors: true,
};

let registered = false;

/**
 * Reset the SDK registration state.
 * Use this for testing or to allow re-registration.
 */
export function reset(): void {
  registered = false;
}

/**
 * Register Bugwatch in Next.js instrumentation.ts
 *
 * Call this in your project's instrumentation.ts file
 * to enable server-side error tracking.
 */
export function registerBugwatch(options: RegisterOptions = {}): void {
  if (registered) {
    return;
  }

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const envConfig = getEnvConfig();
  const apiKey = mergedOptions.apiKey || envConfig.apiKey;
  const endpoint = mergedOptions.endpoint || envConfig.endpoint;

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] No API key provided. Set NEXT_PUBLIC_BUGWATCH_API_KEY environment variable."
      );
    }
    return;
  }

  const runtime = mergedOptions.runtime || detectRuntime();

  if (runtime === "edge") {
    initEdge(apiKey, endpoint, mergedOptions);
  } else {
    initNode(apiKey, endpoint, mergedOptions);
  }

  registered = true;
}

/**
 * Detect the Next.js runtime environment
 */
function detectRuntime(): "nodejs" | "edge" {
  // Check for Edge Runtime global
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }

  // Check Next.js runtime environment variable
  if (process.env.NEXT_RUNTIME === "edge") {
    return "edge";
  }

  return "nodejs";
}

declare const EdgeRuntime: string | undefined;

/**
 * Initialize for Node.js runtime
 */
function initNode(apiKey: string, endpoint: string | undefined, options: RegisterOptions): void {
  const { init } = require("./index");

  init({
    apiKey,
    ...(endpoint && { endpoint }),
    environment: process.env.NODE_ENV || "production",
    debug: options.debug || process.env.BUGWATCH_DEBUG === "true",
    captureUncaughtExceptions: options.captureUncaughtExceptions,
    captureUnhandledRejections: options.captureUnhandledRejections,
  });

  // Hook console.error to auto-capture server-side errors that are
  // caught by application code (try-catch) and only logged, never thrown.
  if (options.captureConsoleErrors !== false) {
    setupConsoleErrorCapture();
  }

  if (options.debug || process.env.BUGWATCH_DEBUG === "true") {
    console.log("[Bugwatch] Server-side tracking initialized (Node.js runtime)");
  }
}

/**
 * Initialize for Edge runtime
 */
function initEdge(apiKey: string, endpoint: string | undefined, options: RegisterOptions): void {
  const { init } = require("@bugwatch/core");

  init({
    apiKey,
    ...(endpoint && { endpoint }),
    environment: process.env.NODE_ENV || "production",
    debug: options.debug || process.env.BUGWATCH_DEBUG === "true",
  });

  if (options.debug || process.env.BUGWATCH_DEBUG === "true") {
    console.log("[Bugwatch] Server-side tracking initialized (Edge runtime)");
  }
}

/**
 * Hook console.error to automatically capture server-side errors.
 *
 * Many server errors are caught by application code and only logged
 * via console.error (e.g., API timeouts, cache permission errors).
 * This hook detects Error objects in the arguments and reports them.
 */
function setupConsoleErrorCapture(): void {
  const originalConsoleError = console.error;
  let inCapture = false;

  console.error = (...args: unknown[]) => {
    // Always call the original first so logs are never lost
    originalConsoleError.apply(console, args);

    // Guard against recursion (captureException might log internally)
    if (inCapture) return;
    inCapture = true;

    try {
      const { captureException, captureMessage, getClient } = require("@bugwatch/core");
      if (!getClient()) return;

      // Look for an Error object in the arguments
      const error = args.find((arg): arg is Error => arg instanceof Error);

      if (error) {
        // Skip Bugwatch's own internal logs
        const message = String(args[0] || "");
        if (message.startsWith("[Bugwatch]")) return;

        captureException(error, {
          level: "warning",
          tags: { mechanism: "console.error" },
          extra: {
            console_args: args
              .filter((a) => !(a instanceof Error))
              .map((a) => {
                try { return String(a); } catch { return "[unstringifiable]"; }
              })
              .join(" ") || undefined,
          },
        });
      } else {
        // No Error object — capture the message text if it looks like an error
        const text = args.map((a) => {
          try { return String(a); } catch { return "[unstringifiable]"; }
        }).join(" ");

        // Skip Next.js internal warnings and Bugwatch's own logs
        if (
          text.startsWith("[Bugwatch]") ||
          text.startsWith("Warning:") ||
          text.startsWith("⚠") ||
          text.includes("Fast Refresh") ||
          text.includes("next-dev.js")
        ) return;

        // Only capture if it contains error-like keywords
        const lowerText = text.toLowerCase();
        if (
          lowerText.includes("error") ||
          lowerText.includes("failed") ||
          lowerText.includes("exception") ||
          lowerText.includes("timeout") ||
          lowerText.includes("eacces") ||
          lowerText.includes("enoent") ||
          lowerText.includes("econnrefused")
        ) {
          captureMessage(text.slice(0, 1000), "warning");
        }
      }
    } catch {
      // Never let capture logic break console.error
    } finally {
      inCapture = false;
    }
  };
}

/**
 * Check if Bugwatch has been registered
 */
export function isRegistered(): boolean {
  return registered;
}

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
export async function onRequestError(
  err: { digest?: string } & Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "page" | "route" | "action" | "middleware";
    renderSource?:
      | "react-server-components"
      | "react-server-components-payload"
      | "server-rendering";
  }
): Promise<void> {
  // Lazy-import to avoid issues if core isn't initialized yet
  const { captureException, getClient } = await import("@bugwatch/core");

  captureException(err, {
    level: "error",
    tags: {
      mechanism: "nextjs.onRequestError",
      "next.routerKind": context.routerKind,
      "next.routePath": context.routePath,
      "next.routeType": context.routeType,
      ...(context.renderSource && { "next.renderSource": context.renderSource }),
      ...(err.digest && { "next.digest": err.digest }),
    },
    request: {
      url: request.path,
      method: request.method,
      headers: sanitizeHeaders(request.headers),
    },
  });

  // Best-effort flush so the event is sent before the response completes
  const client = getClient();
  if (client) {
    await client.flush().catch(() => {});
  }
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const sensitiveKeys = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
  ];

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = "[Filtered]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
