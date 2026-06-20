import { BugwatchOptions } from '@bugwatch/core';

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
declare function getEnvConfig(): Partial<BugwatchOptions>;
/**
 * Check if API key is available from environment variables.
 */
declare function hasApiKey(): boolean;

export { getEnvConfig, hasApiKey };
