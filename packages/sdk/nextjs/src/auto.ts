/**
 * Auto-initialization module for zero-config setup
 * Usage: import '@bugwatch/nextjs/auto'
 *
 * Reads configuration from environment variables and initializes
 * the appropriate SDK (server or client) automatically.
 *
 * Supports two configuration methods:
 * 1. DSN format: NEXT_PUBLIC_BUGWATCH_DSN
 * 2. Individual env vars:
 *    - Server: BUGWATCH_API_KEY, BUGWATCH_ENVIRONMENT, etc.
 *    - Client: NEXT_PUBLIC_BUGWATCH_API_KEY, NEXT_PUBLIC_BUGWATCH_ENVIRONMENT, etc.
 */

import { parseDsn, getDsnFromEnv, getEnvConfig, hasApiKey, type DsnComponents } from "./config";
import type { BugwatchOptions } from "@bugwatch/core";

let initialized = false;

/**
 * Auto-initialize Bugwatch based on environment
 */
function autoInit(): void {
  if (initialized) return;

  // Try DSN format first
  const dsn = getDsnFromEnv();
  if (dsn) {
    const config = parseDsn(dsn);
    if (!config) {
      console.error("[Bugwatch] Invalid DSN format. Error tracking disabled.");
      return;
    }

    if (typeof window === "undefined") {
      initServerFromDsn(config);
    } else {
      initClientFromDsn(config);
    }

    initialized = true;
    return;
  }

  // Fall back to individual env vars
  if (hasApiKey()) {
    const envConfig = getEnvConfig();

    if (typeof window === "undefined") {
      initServerFromEnv(envConfig);
    } else {
      initClientFromEnv(envConfig);
    }

    initialized = true;
    return;
  }

  // No configuration found
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[Bugwatch] No configuration found. Set BUGWATCH_API_KEY (server) or NEXT_PUBLIC_BUGWATCH_API_KEY (client), or use NEXT_PUBLIC_BUGWATCH_DSN."
    );
  }
}

/**
 * Initialize server-side SDK from DSN
 */
function initServerFromDsn(config: DsnComponents): void {
  try {
    const { init } = require("./index");

    init({
      apiKey: config.publicKey,
      endpoint: config.endpoint,
      environment: process.env.BUGWATCH_ENVIRONMENT || process.env.NODE_ENV || "production",
      release: process.env.BUGWATCH_RELEASE,
      debug: process.env.BUGWATCH_DEBUG === "true",
    });

    if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Server SDK auto-initialized (DSN)");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Server SDK initialization failed:", err);
    }
    // Gracefully degrade - don't crash the app
  }
}

/**
 * Initialize server-side SDK from individual env vars
 */
function initServerFromEnv(envConfig: Partial<BugwatchOptions>): void {
  try {
    const { init } = require("./index");

    init({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production",
    });

    if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Server SDK auto-initialized (env vars)");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Server SDK initialization failed:", err);
    }
    // Gracefully degrade - don't crash the app
  }
}

/**
 * Initialize client-side SDK from DSN
 */
function initClientFromDsn(config: DsnComponents): void {
  try {
    const { initClient: initClientSdk } = require("./client");

    initClientSdk({
      apiKey: config.publicKey,
      endpoint: config.endpoint,
      environment: process.env.NEXT_PUBLIC_BUGWATCH_ENVIRONMENT || process.env.NODE_ENV || "production",
      release: process.env.NEXT_PUBLIC_BUGWATCH_RELEASE,
      debug: process.env.NEXT_PUBLIC_BUGWATCH_DEBUG === "true",
    });

    if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Client SDK auto-initialized (DSN)");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client SDK initialization failed:", err);
    }
    // Gracefully degrade - don't crash the app
  }
}

/**
 * Initialize client-side SDK from individual env vars
 */
function initClientFromEnv(envConfig: Partial<BugwatchOptions>): void {
  try {
    const { initClient: initClientSdk } = require("./client");

    initClientSdk({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production",
    });

    if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Client SDK auto-initialized (env vars)");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client SDK initialization failed:", err);
    }
    // Gracefully degrade - don't crash the app
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

/**
 * Reset the initialization state.
 * Use this for testing or to allow re-initialization.
 */
export function reset(): void {
  initialized = false;
}

// Auto-initialize on import
autoInit();
