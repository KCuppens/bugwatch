/**
 * Auto-initialization module for zero-config setup
 * Usage: import '@bugwatch/nextjs/auto'
 *
 * Reads NEXT_PUBLIC_BUGWATCH_DSN from environment and initializes
 * the appropriate SDK (server or client) automatically.
 */

import { parseDsn, getDsnFromEnv, type DsnComponents } from "./config";

let initialized = false;

/**
 * Auto-initialize Bugwatch based on environment
 */
function autoInit(): void {
  if (initialized) return;

  const dsn = getDsnFromEnv();

  if (!dsn) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] NEXT_PUBLIC_BUGWATCH_DSN not set. Error tracking disabled."
      );
    }
    return;
  }

  const config = parseDsn(dsn);
  if (!config) {
    console.error("[Bugwatch] Invalid DSN format. Error tracking disabled.");
    return;
  }

  if (typeof window === "undefined") {
    initServer(config);
  } else {
    initClient(config);
  }

  initialized = true;
}

/**
 * Initialize server-side SDK
 */
function initServer(config: DsnComponents): void {
  // Dynamic import to avoid bundling server code in client
  const { init } = require("./index");

  init({
    apiKey: config.publicKey,
    endpoint: config.endpoint,
    environment: process.env.NODE_ENV || "production",
    debug: process.env.BUGWATCH_DEBUG === "true",
  });

  if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
    console.log("[Bugwatch] Server SDK auto-initialized");
  }
}

/**
 * Initialize client-side SDK
 */
function initClient(config: DsnComponents): void {
  // Dynamic import to avoid bundling client code in server
  const { initClient: initClientSdk } = require("./client");

  initClientSdk({
    apiKey: config.publicKey,
    endpoint: config.endpoint,
    environment: process.env.NODE_ENV || "production",
    debug: process.env.BUGWATCH_DEBUG === "true",
  });

  if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
    console.log("[Bugwatch] Client SDK auto-initialized");
  }
}

/**
 * Check if Bugwatch has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Manually trigger auto-initialization (useful for testing)
 */
export function ensureInitialized(): void {
  autoInit();
}

// Auto-initialize on import
autoInit();
