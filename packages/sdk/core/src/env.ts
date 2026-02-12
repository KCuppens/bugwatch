/**
 * Environment variable utilities for Bugwatch SDK.
 *
 * This module provides functions for reading configuration from environment
 * variables and validating API keys.
 */

import type { BugwatchOptions } from "./types";

/**
 * Supported environment variables for Bugwatch configuration.
 */
export const ENV_VARS = {
  API_KEY: "BUGWATCH_API_KEY",
  ENVIRONMENT: "BUGWATCH_ENVIRONMENT",
  RELEASE: "BUGWATCH_RELEASE",
  DEBUG: "BUGWATCH_DEBUG",
  ENDPOINT: "BUGWATCH_ENDPOINT",
} as const;

/**
 * Get environment variable value safely across different runtimes.
 */
function getEnvVar(name: string): string | undefined {
  // Node.js
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}

/**
 * Read Bugwatch configuration from environment variables.
 *
 * Supported environment variables:
 * - `BUGWATCH_API_KEY` - API key (required unless passed explicitly)
 * - `BUGWATCH_ENVIRONMENT` - Environment tag (e.g., 'production', 'staging')
 * - `BUGWATCH_RELEASE` - Release version
 * - `BUGWATCH_DEBUG` - Enable debug mode ('true' to enable)
 * - `BUGWATCH_ENDPOINT` - Custom API endpoint
 *
 * @returns Partial configuration from environment variables
 *
 * @example
 * ```typescript
 * // Set environment variables
 * // BUGWATCH_API_KEY=bw_live_xxxxx
 * // BUGWATCH_ENVIRONMENT=production
 *
 * const envConfig = getEnvConfig();
 * // { apiKey: 'bw_live_xxxxx', environment: 'production' }
 * ```
 */
export function getEnvConfig(): Partial<BugwatchOptions> {
  const config: Partial<BugwatchOptions> = {};

  const apiKey = getEnvVar(ENV_VARS.API_KEY);
  if (apiKey) {
    config.apiKey = apiKey;
  }

  const environment = getEnvVar(ENV_VARS.ENVIRONMENT);
  if (environment) {
    config.environment = environment;
  }

  const release = getEnvVar(ENV_VARS.RELEASE);
  if (release) {
    config.release = release;
  }

  const debug = getEnvVar(ENV_VARS.DEBUG);
  if (debug === "true") {
    config.debug = true;
  }

  const endpoint = getEnvVar(ENV_VARS.ENDPOINT);
  if (endpoint) {
    config.endpoint = endpoint;
  }

  return config;
}

/**
 * Validate an API key and throw a clear error if invalid.
 *
 * @param key - The API key to validate
 * @throws Error if the API key is missing or invalid
 *
 * @example
 * ```typescript
 * // Missing API key
 * validateApiKey(undefined);
 * // throws: "Bugwatch: API key required. Set BUGWATCH_API_KEY environment variable or pass { apiKey: '...' }"
 *
 * // Invalid format (logs warning but doesn't throw)
 * validateApiKey("invalid-key");
 * // warns: "Bugwatch: API key should start with 'bw_'. Got 'invali...'"
 * ```
 */
export function validateApiKey(key: string | undefined): asserts key is string {
  if (!key) {
    throw new Error(
      "Bugwatch: API key required. " +
        "Set BUGWATCH_API_KEY environment variable or pass { apiKey: '...' }"
    );
  }

  if (!key.startsWith("bw_")) {
    // Only show prefix if key is long enough to not expose the full key
    const preview = key.length > 10 ? `${key.slice(0, 6)}...` : "[hidden]";
    console.warn(
      `Bugwatch: API key should start with 'bw_'. Got '${preview}'`
    );
  }
}

/**
 * Check if API key is available (either in env or passed explicitly).
 *
 * @param explicitKey - Explicitly provided API key
 * @returns true if an API key is available
 */
export function hasApiKey(explicitKey?: string): boolean {
  return Boolean(explicitKey || getEnvVar(ENV_VARS.API_KEY));
}
