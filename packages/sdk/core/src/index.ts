// Core client
export { Bugwatch } from "./client";

// Types
export type {
  BugwatchOptions,
  BugwatchClient,
  ErrorEvent,
  ExceptionInfo,
  StackFrame,
  Breadcrumb,
  UserContext,
  RequestContext,
  RuntimeInfo,
  SdkInfo,
  Transport,
  Integration,
} from "./types";

// Transport implementations
export {
  HttpTransport,
  NoopTransport,
  ConsoleTransport,
  BatchTransport,
} from "./transport";

// Utilities
export { parseStackTrace, extractErrorInfo } from "./stacktrace";
export { generateFingerprint, fingerprintFromException } from "./fingerprint";

// Environment utilities
export { getEnvConfig, validateApiKey, hasApiKey, ENV_VARS } from "./env";

// Request context utilities (for request-scoped context isolation)
export {
  runWithContext,
  runWithContextAsync,
  getRequestContext,
  hasRequestContext,
  createScopedContext,
  setRequestUser,
  setRequestTag,
  setRequestExtra,
  addRequestBreadcrumb,
  getMergedContext,
  type ScopedContext,
} from "./context";

// Global instance management
let globalClient: import("./client").Bugwatch | null = null;
let lazyInitWarned = false;

/**
 * Initialize the global Bugwatch client.
 *
 * Reads configuration from environment variables if not explicitly provided:
 * - `BUGWATCH_API_KEY` - API key (required)
 * - `BUGWATCH_ENVIRONMENT` - Environment tag
 * - `BUGWATCH_RELEASE` - Release version
 * - `BUGWATCH_DEBUG` - Enable debug mode ('true')
 *
 * @param options - Configuration options (optional if BUGWATCH_API_KEY env var is set)
 * @throws Error if no API key is provided and BUGWATCH_API_KEY is not set
 *
 * @example
 * ```typescript
 * // With env var BUGWATCH_API_KEY set
 * init();
 *
 * // Or explicit configuration
 * init({ apiKey: "bw_live_xxxxx" });
 *
 * // Mix of env vars and explicit options
 * init({ environment: "staging" }); // Uses BUGWATCH_API_KEY from env
 * ```
 */
export function init(options?: Partial<import("./types").BugwatchOptions>): import("./client").Bugwatch {
  const { Bugwatch } = require("./client");
  const { getEnvConfig, validateApiKey } = require("./env");

  // Merge env config with explicit options (explicit takes precedence)
  const envConfig = getEnvConfig();
  const mergedOptions = { ...envConfig, ...options };

  // Validate API key
  validateApiKey(mergedOptions.apiKey);

  const client = new Bugwatch(mergedOptions as import("./types").BugwatchOptions);
  globalClient = client;
  lazyInitWarned = false;
  return client;
}

/**
 * Get the global Bugwatch client
 */
export function getClient(): import("./client").Bugwatch | null {
  return globalClient;
}

/**
 * Try to lazily initialize from environment variables.
 * Returns true if initialization succeeded, false otherwise.
 */
function tryLazyInit(): boolean {
  if (globalClient) return true;

  const { getEnvConfig, hasApiKey } = require("./env");

  if (!hasApiKey()) {
    return false;
  }

  try {
    const { Bugwatch } = require("./client");
    const envConfig = getEnvConfig();

    // Double-check that apiKey is present (defensive programming)
    if (!envConfig.apiKey) {
      return false;
    }

    const client = new Bugwatch(envConfig as import("./types").BugwatchOptions);
    globalClient = client;

    // Log warning in debug mode
    if (envConfig.debug && !lazyInitWarned) {
      console.warn("[Bugwatch] Auto-initialized from BUGWATCH_API_KEY environment variable");
      lazyInitWarned = true;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Capture an exception using the global client.
 *
 * If the SDK is not initialized but BUGWATCH_API_KEY environment variable is set,
 * the SDK will auto-initialize before capturing.
 */
export function captureException(
  error: Error,
  context?: Partial<import("./types").ErrorEvent>
): string {
  // Try lazy initialization if not initialized
  if (!globalClient && !tryLazyInit()) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first or set BUGWATCH_API_KEY environment variable.");
    return "";
  }
  return globalClient!.captureException(error, context);
}

/**
 * Capture a message using the global client.
 *
 * If the SDK is not initialized but BUGWATCH_API_KEY environment variable is set,
 * the SDK will auto-initialize before capturing.
 */
export function captureMessage(
  message: string,
  level?: import("./types").ErrorEvent["level"]
): string {
  // Try lazy initialization if not initialized
  if (!globalClient && !tryLazyInit()) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first or set BUGWATCH_API_KEY environment variable.");
    return "";
  }
  return globalClient!.captureMessage(message, level);
}

/**
 * Add a breadcrumb using the global client.
 * If called within a request context, adds to the request-scoped breadcrumbs.
 */
export function addBreadcrumb(
  breadcrumb: Omit<import("./types").Breadcrumb, "timestamp">
): void {
  if (!globalClient) {
    return;
  }

  // Try to add to request context first
  const { addRequestBreadcrumb } = require("./context");
  const crumb = {
    ...breadcrumb,
    timestamp: new Date().toISOString(),
  };
  if (addRequestBreadcrumb(crumb, globalClient.getOptions().maxBreadcrumbs || 100)) {
    return; // Added to request context
  }

  // Fall back to global client
  globalClient.addBreadcrumb(breadcrumb);
}

/**
 * Set user context.
 * If called within a request context, sets the request-scoped user.
 * Otherwise sets the global user context.
 */
export function setUser(user: import("./types").UserContext | null): void {
  if (!globalClient) {
    return;
  }

  // Try to set on request context first
  const { setRequestUser } = require("./context");
  if (setRequestUser(user)) {
    return; // Set on request context
  }

  // Fall back to global client
  globalClient.setUser(user);
}

/**
 * Set a tag.
 * If called within a request context, sets the request-scoped tag.
 * Otherwise sets the global tag.
 */
export function setTag(key: string, value: string): void {
  if (!globalClient) {
    return;
  }

  // Try to set on request context first
  const { setRequestTag } = require("./context");
  if (setRequestTag(key, value)) {
    return; // Set on request context
  }

  // Fall back to global client
  globalClient.setTag(key, value);
}

/**
 * Set extra context.
 * If called within a request context, sets the request-scoped extra.
 * Otherwise sets the global extra context.
 */
export function setExtra(key: string, value: unknown): void {
  if (!globalClient) {
    return;
  }

  // Try to set on request context first
  const { setRequestExtra } = require("./context");
  if (setRequestExtra(key, value)) {
    return; // Set on request context
  }

  // Fall back to global client
  globalClient.setExtra(key, value);
}

/**
 * Flush any pending events using the global client.
 * Call this before process exit to ensure no events are lost.
 */
export async function flush(): Promise<void> {
  if (!globalClient) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first.");
    return;
  }
  await globalClient.flush();
}

/**
 * Close the global client and release any resources.
 * This flushes any pending events and closes the transport.
 * After calling this method, the client should not be used again.
 */
export async function close(): Promise<void> {
  if (!globalClient) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first.");
    return;
  }
  await globalClient.close();
  globalClient = null;
}

/**
 * Reset the SDK state completely.
 * Use this for testing or to allow re-initialization.
 * Note: This does NOT flush pending events - call close() first if needed.
 */
export function reset(): void {
  globalClient = null;
  lazyInitWarned = false;
}
