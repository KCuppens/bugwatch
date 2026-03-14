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
}

const DEFAULT_OPTIONS: RegisterOptions = {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
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
