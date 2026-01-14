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
