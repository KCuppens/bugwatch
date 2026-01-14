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

// Global instance management
let globalClient: import("./client").Bugwatch | null = null;

/**
 * Initialize the global Bugwatch client
 */
export function init(options: import("./types").BugwatchOptions): import("./client").Bugwatch {
  const { Bugwatch } = require("./client");
  const client = new Bugwatch(options);
  globalClient = client;
  return client;
}

/**
 * Get the global Bugwatch client
 */
export function getClient(): import("./client").Bugwatch | null {
  return globalClient;
}

/**
 * Capture an exception using the global client
 */
export function captureException(
  error: Error,
  context?: Partial<import("./types").ErrorEvent>
): string {
  if (!globalClient) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first.");
    return "";
  }
  return globalClient.captureException(error, context);
}

/**
 * Capture a message using the global client
 */
export function captureMessage(
  message: string,
  level?: import("./types").ErrorEvent["level"]
): string {
  if (!globalClient) {
    console.warn("[Bugwatch] SDK not initialized. Call init() first.");
    return "";
  }
  return globalClient.captureMessage(message, level);
}

/**
 * Add a breadcrumb using the global client
 */
export function addBreadcrumb(
  breadcrumb: Omit<import("./types").Breadcrumb, "timestamp">
): void {
  if (!globalClient) {
    return;
  }
  globalClient.addBreadcrumb(breadcrumb);
}

/**
 * Set user context on the global client
 */
export function setUser(user: import("./types").UserContext | null): void {
  if (!globalClient) {
    return;
  }
  globalClient.setUser(user);
}

/**
 * Set a tag on the global client
 */
export function setTag(key: string, value: string): void {
  if (!globalClient) {
    return;
  }
  globalClient.setTag(key, value);
}

/**
 * Set extra context on the global client
 */
export function setExtra(key: string, value: unknown): void {
  if (!globalClient) {
    return;
  }
  globalClient.setExtra(key, value);
}
