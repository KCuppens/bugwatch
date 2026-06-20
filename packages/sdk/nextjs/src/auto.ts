/**
 * Auto-initialization module for zero-config setup
 * Usage: import '@bugwatch/nextjs/auto'
 *
 * Reads configuration from environment variables and initializes
 * the appropriate SDK (server or client) automatically.
 *
 * Environment variables:
 * - Server: BUGWATCH_API_KEY, BUGWATCH_ENVIRONMENT, etc.
 * - Client: NEXT_PUBLIC_BUGWATCH_API_KEY, NEXT_PUBLIC_BUGWATCH_ENVIRONMENT, etc.
 */

import { getEnvConfig, hasApiKey } from "./config";
import type { BugwatchOptions } from "@bugwatch/core";

let initialized = false;

/**
 * Auto-initialize Bugwatch based on environment
 */
function autoInit(): void {
  if (initialized) return;

  if (!hasApiKey()) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] No API key found. Set BUGWATCH_API_KEY (server) or NEXT_PUBLIC_BUGWATCH_API_KEY (client)."
      );
    }
    return;
  }

  const envConfig = getEnvConfig();

  if (typeof window === "undefined") {
    initServer(envConfig);
  } else {
    initClient(envConfig);
  }

  initialized = true;
}

/**
 * Initialize server-side SDK
 */
function initServer(envConfig: Partial<BugwatchOptions>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { init } = require("./index");

    init({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production",
    });

    if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Server SDK auto-initialized");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Server SDK initialization failed:", err);
    }
  }
}

/**
 * Initialize client-side SDK
 */
function initClient(envConfig: Partial<BugwatchOptions>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initClient: initClientSdk } = require("./client");

    initClientSdk({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production",
    });

    if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Client SDK auto-initialized");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client SDK initialization failed:", err);
    }
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
