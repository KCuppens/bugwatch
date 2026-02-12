import type { BugwatchOptions } from "@bugwatch/core";

/**
 * DSN format: https://<public_key>@<host>/<project_id>
 * Example: https://abc123@api.bugwatch.dev/42
 */
export interface DsnComponents {
  publicKey: string;
  host: string;
  projectId: string;
  endpoint: string;
}

/**
 * Parse a Bugwatch DSN into its components
 */
export function parseDsn(dsn: string): DsnComponents | null {
  try {
    const url = new URL(dsn);

    // Extract public key from username portion
    const publicKey = url.username;
    if (!publicKey) return null;

    // Extract host
    const host = url.host;

    // Extract project ID from path
    const projectId = url.pathname.replace(/^\//, "");
    if (!projectId) return null;

    // Construct the API endpoint
    const endpoint = `${url.protocol}//${host}/api/v1/projects/${projectId}/events`;

    return {
      publicKey,
      host,
      projectId,
      endpoint,
    };
  } catch {
    return null;
  }
}

/**
 * Get DSN from environment variable
 */
export function getDsnFromEnv(): string | null {
  return (
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_BUGWATCH_DSN) ||
    null
  );
}

/**
 * Validate DSN format
 */
export function isValidDsn(dsn: string): boolean {
  return parseDsn(dsn) !== null;
}

/**
 * Get Bugwatch configuration from environment variables.
 *
 * On the server side, reads from:
 * - `BUGWATCH_API_KEY` - API key
 * - `BUGWATCH_ENVIRONMENT` - Environment tag
 * - `BUGWATCH_RELEASE` - Release version
 * - `BUGWATCH_DEBUG` - Enable debug mode ('true')
 * - `BUGWATCH_ENDPOINT` - Custom API endpoint
 *
 * On the client side, reads from:
 * - `NEXT_PUBLIC_BUGWATCH_API_KEY` - API key
 * - `NEXT_PUBLIC_BUGWATCH_ENVIRONMENT` - Environment tag
 * - `NEXT_PUBLIC_BUGWATCH_RELEASE` - Release version
 * - `NEXT_PUBLIC_BUGWATCH_DEBUG` - Enable debug mode ('true')
 * - `NEXT_PUBLIC_BUGWATCH_ENDPOINT` - Custom API endpoint
 *
 * @returns Partial configuration from environment variables
 */
export function getEnvConfig(): Partial<BugwatchOptions> {
  const config: Partial<BugwatchOptions> = {};

  // Server-side: use standard env vars
  if (typeof window === "undefined") {
    const apiKey = process.env.BUGWATCH_API_KEY;
    if (apiKey) config.apiKey = apiKey;

    const environment = process.env.BUGWATCH_ENVIRONMENT;
    if (environment) config.environment = environment;

    const release = process.env.BUGWATCH_RELEASE;
    if (release) config.release = release;

    const debug = process.env.BUGWATCH_DEBUG;
    if (debug === "true") config.debug = true;

    const endpoint = process.env.BUGWATCH_ENDPOINT;
    if (endpoint) config.endpoint = endpoint;
  } else {
    // Client-side: use NEXT_PUBLIC_ prefix
    const apiKey = process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;
    if (apiKey) config.apiKey = apiKey;

    const environment = process.env.NEXT_PUBLIC_BUGWATCH_ENVIRONMENT;
    if (environment) config.environment = environment;

    const release = process.env.NEXT_PUBLIC_BUGWATCH_RELEASE;
    if (release) config.release = release;

    const debug = process.env.NEXT_PUBLIC_BUGWATCH_DEBUG;
    if (debug === "true") config.debug = true;

    const endpoint = process.env.NEXT_PUBLIC_BUGWATCH_ENDPOINT;
    if (endpoint) config.endpoint = endpoint;
  }

  return config;
}

/**
 * Check if API key is available from environment variables.
 */
export function hasApiKey(): boolean {
  if (typeof window === "undefined") {
    return Boolean(process.env.BUGWATCH_API_KEY);
  }
  return Boolean(process.env.NEXT_PUBLIC_BUGWATCH_API_KEY);
}
