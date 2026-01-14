import type { ExceptionInfo, StackFrame } from "./types";

/**
 * Generate a fingerprint for an error to group similar errors together.
 * Uses a combination of error type, message patterns, and stack trace.
 */
export function generateFingerprint(
  errorType: string,
  message: string,
  stacktrace?: StackFrame[]
): string {
  const components: string[] = [];

  // 1. Error type
  components.push(errorType);

  // 2. Normalized message (remove dynamic values)
  const normalizedMessage = normalizeErrorMessage(message);
  components.push(normalizedMessage);

  // 3. Top in-app stack frame location
  if (stacktrace && stacktrace.length > 0) {
    const topInAppFrame = stacktrace.find((frame) => frame.in_app);
    if (topInAppFrame) {
      components.push(`${topInAppFrame.filename}:${topInAppFrame.function}`);
    } else {
      // Fall back to first frame
      const firstFrame = stacktrace[0];
      if (firstFrame) {
        components.push(`${firstFrame.filename}:${firstFrame.function}`);
      }
    }
  }

  // Generate hash from components
  return hashString(components.join("|"));
}

/**
 * Generate fingerprint from exception info
 */
export function fingerprintFromException(exception: ExceptionInfo): string {
  return generateFingerprint(
    exception.type,
    exception.value,
    exception.stacktrace
  );
}

/**
 * Normalize error message by removing dynamic values like:
 * - Numbers
 * - UUIDs
 * - URLs with dynamic segments
 * - Timestamps
 * - Memory addresses
 */
function normalizeErrorMessage(message: string): string {
  return (
    message
      // Replace UUIDs
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "<UUID>"
      )
      // Replace hex addresses (0x...)
      .replace(/0x[0-9a-f]+/gi, "<ADDR>")
      // Replace numbers
      .replace(/\b\d+\b/g, "<N>")
      // Replace quoted strings
      .replace(/"[^"]*"/g, '"<STR>"')
      .replace(/'[^']*'/g, "'<STR>'")
      // Replace URLs
      .replace(/https?:\/\/[^\s]+/g, "<URL>")
      // Replace file paths
      .replace(/\/[\w\-./]+\.\w+/g, "<PATH>")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Simple string hash function (FNV-1a)
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}
