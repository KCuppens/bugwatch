import type { StackFrame } from "./types";

/**
 * Parse an Error's stack trace into structured frames
 */
export function parseStackTrace(error: Error): StackFrame[] {
  const stack = error.stack;
  if (!stack) {
    return [];
  }

  const frames: StackFrame[] = [];
  const lines = stack.split("\n");

  for (const line of lines) {
    const frame = parseStackLine(line);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * Parse a single stack trace line
 * Handles various formats:
 * - Chrome/Node: "    at functionName (file:line:col)"
 * - Firefox: "functionName@file:line:col"
 * - Safari: "functionName@file:line:col"
 */
function parseStackLine(line: string): StackFrame | null {
  // Skip empty lines and error message lines
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("Error:") || trimmed.startsWith("at ") === false && !trimmed.includes("@")) {
    // Check if it's a Chrome/Node format without "at"
    if (!trimmed.includes("@") && !trimmed.startsWith("at ")) {
      return null;
    }
  }

  // Chrome/Node format: "at functionName (file:line:col)" or "at file:line:col"
  const chromeMatch = trimmed.match(
    /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|(.+?):(\d+)|(.+))\)?$/
  );

  if (chromeMatch) {
    const [, func, file1, line1, col1, file2, line2, file3] = chromeMatch;
    const filename = file1 || file2 || file3 || "<anonymous>";
    const lineno = parseInt(line1 || line2 || "0", 10);
    const colno = parseInt(col1 || "0", 10);

    return {
      filename: normalizeFilename(filename),
      function: func || "<anonymous>",
      lineno,
      colno,
      in_app: isInAppFrame(filename),
    };
  }

  // Firefox/Safari format: "functionName@file:line:col"
  const firefoxMatch = trimmed.match(/^(.+?)@(.+?):(\d+):(\d+)$/);

  if (firefoxMatch) {
    const [, func, file, lineStr, colStr] = firefoxMatch;
    const filename = file || "<anonymous>";
    const lineno = parseInt(lineStr || "0", 10);
    const colno = parseInt(colStr || "0", 10);

    return {
      filename: normalizeFilename(filename),
      function: func || "<anonymous>",
      lineno,
      colno,
      in_app: isInAppFrame(filename),
    };
  }

  return null;
}

/**
 * Normalize filename by removing common prefixes
 */
function normalizeFilename(filename: string): string {
  // Remove webpack:// prefix
  let normalized = filename.replace(/^webpack:\/\/[^/]*\//, "");

  // Remove file:// prefix
  normalized = normalized.replace(/^file:\/\//, "");

  // Remove leading ./
  normalized = normalized.replace(/^\.\//, "");

  // Remove query strings
  normalized = normalized.replace(/\?.*$/, "");

  return normalized;
}

/**
 * Determine if a frame is from the application code (not a library)
 */
function isInAppFrame(filename: string): boolean {
  // Node modules are not in-app
  if (filename.includes("node_modules")) {
    return false;
  }

  // Internal Node.js modules
  if (
    filename.startsWith("node:") ||
    filename.startsWith("internal/") ||
    filename.includes("(native)")
  ) {
    return false;
  }

  // Browser built-ins
  if (filename.startsWith("<") || filename === "native code") {
    return false;
  }

  // Common bundler/framework internals
  const internalPatterns = [
    /webpack\/runtime/,
    /webpack\/bootstrap/,
    /turbopack/,
    /__next/,
    /next\/dist/,
    /react-dom/,
    /react\/cjs/,
    /scheduler/,
  ];

  for (const pattern of internalPatterns) {
    if (pattern.test(filename)) {
      return false;
    }
  }

  return true;
}

/**
 * Extract error name and message from Error object
 */
export function extractErrorInfo(error: Error): { type: string; value: string } {
  const type = error.name || "Error";
  const value = error.message || String(error);

  return { type, value };
}
