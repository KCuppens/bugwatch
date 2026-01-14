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

import { parseDsn, getDsnFromEnv, type DsnComponents } from "./config";

export interface RegisterOptions {
  /** Override the runtime detection */
  runtime?: "nodejs" | "edge";
  /** Override the DSN from environment */
  dsn?: string;
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
  const dsn = mergedOptions.dsn || getDsnFromEnv();

  if (!dsn) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] No DSN provided. Set NEXT_PUBLIC_BUGWATCH_DSN environment variable."
      );
    }
    return;
  }

  const config = parseDsn(dsn);
  if (!config) {
    console.error("[Bugwatch] Invalid DSN format. Server-side tracking disabled.");
    return;
  }

  const runtime = mergedOptions.runtime || detectRuntime();

  if (runtime === "edge") {
    initEdge(config, mergedOptions);
  } else {
    initNode(config, mergedOptions);
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
function initNode(config: DsnComponents, options: RegisterOptions): void {
  const { init } = require("./index");

  init({
    apiKey: config.publicKey,
    endpoint: config.endpoint,
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
function initEdge(config: DsnComponents, options: RegisterOptions): void {
  // Edge runtime uses core SDK directly (lighter weight)
  const { init } = require("@bugwatch/core");

  init({
    apiKey: config.publicKey,
    endpoint: config.endpoint,
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
