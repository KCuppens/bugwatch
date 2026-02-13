import type { BugwatchOptions } from "@bugwatch/core";

/**
 * Get Bugwatch configuration from environment variables.
 *
 * Reads from (in priority order):
 * - Server-only vars: `BUGWATCH_API_KEY`, `BUGWATCH_ENVIRONMENT`, etc.
 * - Public vars: `NEXT_PUBLIC_BUGWATCH_API_KEY`, `NEXT_PUBLIC_BUGWATCH_ENVIRONMENT`, etc.
 *
 * In Next.js, NEXT_PUBLIC_ vars are available on both server and client,
 * so most users only need to set those.
 *
 * @returns Partial configuration from environment variables
 */
export function getEnvConfig(): Partial<BugwatchOptions> {
  const config: Partial<BugwatchOptions> = {};

  const apiKey = process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;
  if (apiKey) config.apiKey = apiKey;

  const environment = process.env.BUGWATCH_ENVIRONMENT || process.env.NEXT_PUBLIC_BUGWATCH_ENVIRONMENT;
  if (environment) config.environment = environment;

  const release = process.env.BUGWATCH_RELEASE || process.env.NEXT_PUBLIC_BUGWATCH_RELEASE;
  if (release) config.release = release;

  const debug = process.env.BUGWATCH_DEBUG || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG;
  if (debug === "true") config.debug = true;

  const endpoint = process.env.BUGWATCH_ENDPOINT || process.env.NEXT_PUBLIC_BUGWATCH_ENDPOINT;
  if (endpoint) config.endpoint = endpoint;

  return config;
}

/**
 * Check if API key is available from environment variables.
 */
export function hasApiKey(): boolean {
  return Boolean(process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY);
}
