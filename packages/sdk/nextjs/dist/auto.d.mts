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
/**
 * Check if Bugwatch has been initialized
 */
declare function isInitialized(): boolean;
/**
 * Manually trigger auto-initialization (useful for testing)
 */
declare function ensureInitialized(): void;
/**
 * Reset the initialization state.
 * Use this for testing or to allow re-initialization.
 */
declare function reset(): void;

export { ensureInitialized, isInitialized, reset };
