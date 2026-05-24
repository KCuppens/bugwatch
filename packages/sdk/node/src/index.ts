import os from "os";
import {
  init as coreInit,
  getClient,
  getEnvConfig,
  type BugwatchOptions,
  type BugwatchClient,
  type Integration,
} from "@bugwatch/core";

// Re-export everything from core
export * from "@bugwatch/core";

/**
 * Node.js specific options
 */
export interface NodeOptions extends BugwatchOptions {
  /** Automatically capture uncaught exceptions (default: true) */
  captureUncaughtExceptions?: boolean;
  /** Automatically capture unhandled promise rejections (default: true) */
  captureUnhandledRejections?: boolean;
  /** Exit process after capturing uncaught exception (default: true) */
  exitOnUncaughtException?: boolean;
  /** Timeout before exiting after uncaught exception in ms (default: 2000) */
  shutdownTimeout?: number;
  /** Capture errors logged via console.error (default: true) */
  captureConsoleErrors?: boolean;
}

const DEFAULT_NODE_OPTIONS: Partial<NodeOptions> = {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  exitOnUncaughtException: true,
  shutdownTimeout: 2000,
  captureConsoleErrors: true,
};

let uncaughtExceptionHandler: ((err: unknown) => void) | null = null;
let unhandledRejectionHandler: ((reason: unknown) => void) | null = null;

// Track cleanup functions for proper teardown
let cleanupFunctions: (() => void)[] = [];
let exitHandler: (() => void) | null = null;
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;

/**
 * Set up the Bugwatch SDK for Node.js with minimal configuration.
 *
 * Reads configuration from environment variables:
 * - `BUGWATCH_API_KEY` - API key (required unless passed explicitly)
 * - `BUGWATCH_ENVIRONMENT` - Environment tag
 * - `BUGWATCH_RELEASE` - Release version
 * - `BUGWATCH_DEBUG` - Enable debug mode ('true')
 *
 * @param options - Optional configuration to override env vars
 * @returns The initialized Bugwatch client
 *
 * @example
 * ```typescript
 * // With BUGWATCH_API_KEY env var set
 * setup();
 *
 * // With explicit options
 * setup({ environment: "production" });
 *
 * // Full explicit configuration
 * setup({ apiKey: "bw_live_xxxxx", environment: "staging" });
 * ```
 */
export function setup(options?: Partial<NodeOptions>): BugwatchClient {
  // If already initialized, return existing client
  const existing = getClient();
  if (existing) return existing;

  // Merge env config with explicit options (explicit takes precedence)
  const envConfig = getEnvConfig();
  const mergedOptions = { ...DEFAULT_NODE_OPTIONS, ...envConfig, ...options };

  return init(mergedOptions as NodeOptions);
}

/**
 * Initialize the Bugwatch SDK for Node.js
 */
export function init(options: NodeOptions): BugwatchClient {
  const mergedOptions: NodeOptions = {
    serverName: (() => { try { return os.hostname(); } catch { return undefined; } })(),
    runtime: { name: "node", version: process.version },
    ...DEFAULT_NODE_OPTIONS,
    ...options,
  };

  // Initialize core SDK
  const client = coreInit(mergedOptions);

  // Add OS info as tags for filtering/searching
  client.setTag("os.platform", process.platform);
  client.setTag("os.arch", process.arch);

  // Set up process error handlers
  if (mergedOptions.captureUncaughtExceptions) {
    setupUncaughtExceptionHandler(client, mergedOptions);
  }

  if (mergedOptions.captureUnhandledRejections) {
    setupUnhandledRejectionHandler(client);
  }

  // Capture console.error as warning-level events
  if (mergedOptions.captureConsoleErrors !== false) {
    setupConsoleErrorCapture();
  }

  // Handle process exit
  setupExitHandler();

  if (mergedOptions.debug) {
    console.log("[Bugwatch] Node.js SDK initialized");
  }

  return client;
}

/**
 * Set up handler for uncaught exceptions
 */
function setupUncaughtExceptionHandler(
  client: BugwatchClient,
  options: NodeOptions
): void {
  // Remove existing handler if any
  if (uncaughtExceptionHandler) {
    process.removeListener("uncaughtException", uncaughtExceptionHandler);
  }

  uncaughtExceptionHandler = (err: unknown) => {
    try {
      // Normalize non-Error objects (Node.js can emit strings, objects, etc.)
      const error = err instanceof Error ? err : new Error(String(err));

      client.captureException(error, {
        level: "fatal",
        tags: { mechanism: "uncaughtException" },
      });

      if (options.debug) {
        console.error("[Bugwatch] Captured uncaught exception:", err);
      }
    } catch {
      // Never let the error handler itself crash
    }

    // Flush pending events then exit
    if (options.exitOnUncaughtException) {
      const timeout = options.shutdownTimeout || 2000;

      const flushPromise = client.flush().catch(() => {});
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeout));

      // Use .finally() to guarantee exit even if both promises reject
      Promise.race([flushPromise, timeoutPromise]).finally(() => {
        process.exit(1);
      });
    }
  };

  process.on("uncaughtException", uncaughtExceptionHandler);

  // Track for cleanup
  cleanupFunctions.push(() => {
    if (uncaughtExceptionHandler) {
      process.removeListener("uncaughtException", uncaughtExceptionHandler);
      uncaughtExceptionHandler = null;
    }
  });
}

/**
 * Set up handler for unhandled promise rejections
 */
function setupUnhandledRejectionHandler(client: BugwatchClient): void {
  // Remove existing handler if any
  if (unhandledRejectionHandler) {
    process.removeListener("unhandledRejection", unhandledRejectionHandler);
  }

  unhandledRejectionHandler = (reason: unknown) => {
    const error =
      reason instanceof Error ? reason : new Error(String(reason));

    client.captureException(error, {
      level: "error",
      tags: { mechanism: "unhandledRejection" },
      extra: { reason: String(reason) },
    });

    if (client.getOptions().debug) {
      console.error("[Bugwatch] Captured unhandled rejection:", reason);
    }

    // Best-effort flush — don't block, but try to send the event
    client.flush().catch(() => {
      // Ignore flush errors
    });
  };

  process.on("unhandledRejection", unhandledRejectionHandler);

  // Track for cleanup
  cleanupFunctions.push(() => {
    if (unhandledRejectionHandler) {
      process.removeListener("unhandledRejection", unhandledRejectionHandler);
      unhandledRejectionHandler = null;
    }
  });
}

/**
 * Set up process exit handler for cleanup
 */
function setupExitHandler(): void {
  // Remove existing handlers if any
  if (exitHandler) {
    process.removeListener("exit", exitHandler);
  }
  if (sigintHandler) {
    process.removeListener("SIGINT", sigintHandler);
  }
  if (sigtermHandler) {
    process.removeListener("SIGTERM", sigtermHandler);
  }

  exitHandler = () => {
    // 'exit' event is synchronous — can't flush here.
    // Flushing is handled by SIGINT/SIGTERM handlers instead.
  };

  let shutdownPending = false;

  const gracefulShutdown = (code: number) => {
    if (shutdownPending) return;
    shutdownPending = true;

    const client = getClient();
    if (client) {
      // Race flush against a 2s timeout to prevent hanging
      Promise.race([
        client.flush().catch(() => {}),
        new Promise<void>((r) => setTimeout(r, 2000)),
      ]).finally(() => {
        process.exit(code);
      });
    } else {
      process.exit(code);
    }
  };

  sigintHandler = () => gracefulShutdown(0);
  sigtermHandler = () => gracefulShutdown(0);

  process.on("exit", exitHandler);
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  // Track for cleanup
  cleanupFunctions.push(() => {
    if (exitHandler) {
      process.removeListener("exit", exitHandler);
      exitHandler = null;
    }
    if (sigintHandler) {
      process.removeListener("SIGINT", sigintHandler);
      sigintHandler = null;
    }
    if (sigtermHandler) {
      process.removeListener("SIGTERM", sigtermHandler);
      sigtermHandler = null;
    }
  });
}

/**
 * Hook console.error to automatically capture server-side errors.
 *
 * Many errors are caught by application code and only logged via
 * console.error (e.g., API timeouts, cache permission errors, DB errors).
 * This hook detects Error objects and error-like messages and reports them.
 */
function setupConsoleErrorCapture(): void {
  // Guard against double-wrapping (e.g., init() called twice, or ConsoleIntegration also installed)
  if ((console.error as { __bugwatch_capture?: boolean }).__bugwatch_capture) return;

  const originalConsoleError = console.error;
  let inCapture = false;

  const hookedConsoleError = (...args: unknown[]) => {
    // Always call the original first so logs are never lost
    originalConsoleError.apply(console, args);

    if (inCapture) return;
    inCapture = true;

    try {
      const client = getClient();
      if (!client) return;

      // Skip Bugwatch's own internal logs
      const firstArg = String(args[0] || "");
      if (firstArg.startsWith("[Bugwatch]")) return;

      // Look for an Error object in the arguments
      const error = args.find((arg): arg is Error => arg instanceof Error);

      if (error) {
        client.captureException(error, {
          level: "warning",
          tags: { mechanism: "console.error" },
          extra: {
            console_args: args
              .filter((a) => !(a instanceof Error))
              .map((a) => { try { return String(a); } catch { return "[unstringifiable]"; } })
              .join(" ") || undefined,
          },
        });
      } else {
        // No Error object — check if the text looks like an error
        const text = args.map((a) => {
          try { return String(a); } catch { return "[unstringifiable]"; }
        }).join(" ");

        if (/error|failed|exception|timeout|eacces|enoent|econnrefused/i.test(text)) {
          client.captureMessage(text.slice(0, 1000), "warning");
        }
      }
    } catch {
      // Never let capture logic break console.error
    } finally {
      inCapture = false;
    }
  };

  (hookedConsoleError as { __bugwatch_capture?: boolean }).__bugwatch_capture = true;
  console.error = hookedConsoleError;

  // Track for cleanup
  cleanupFunctions.push(() => {
    if (console.error === hookedConsoleError) {
      console.error = originalConsoleError;
    }
  });
}

/**
 * Express error handler middleware
 */
export function expressErrorHandler() {
  return (
    err: Error,
    req: { method?: string; url?: string; headers?: Record<string, string> },
    res: { statusCode?: number },
    next: (err?: Error) => void
  ) => {
    try {
      const client = getClient();
      if (client) {
        client.captureException(err, {
          request: {
            method: req.method,
            url: req.url,
            headers: sanitizeHeaders(req.headers || {}),
          },
          tags: {
            "http.status_code": String(res.statusCode || 500),
          },
        });
      }
    } catch {
      // Never let error capture break the error handling chain
    }
    next(err);
  };
}

/**
 * Express request handler middleware for breadcrumbs
 */
export function expressRequestHandler() {
  return (
    req: { method?: string; url?: string },
    _res: unknown,
    next: () => void
  ) => {
    const client = getClient();
    if (client) {
      client.addBreadcrumb({
        category: "http",
        message: `${req.method} ${req.url}`,
        level: "info",
        data: { method: req.method, url: req.url },
      });
    }
    next();
  };
}

/**
 * Create a wrapper that captures errors from async functions
 */
export function wrapAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      const client = getClient();
      if (client) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        client.captureException(normalized);
      }
      throw error;
    }
  }) as T;
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "x-xsrf-token",
    "proxy-authorization",
  ];

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else if (value !== undefined) {
      sanitized[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }

  return sanitized;
}

/**
 * Node.js console integration for breadcrumbs.
 * Stores original console methods for cleanup.
 */
let originalConsoleMethods: {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
} | null = null;

export const ConsoleIntegration: Integration = {
  name: "Console",
  setup(client: BugwatchClient) {
    // Store originals for cleanup
    originalConsoleMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    // Guard against recursion: if addBreadcrumb throws, the error would
    // trigger console.error which calls addBreadcrumb again → infinite loop.
    let inBreadcrumb = false;

    function safeBreadcrumb(level: "debug" | "info" | "warning" | "error", args: unknown[]): void {
      if (inBreadcrumb) return;
      inBreadcrumb = true;
      try {
        client.addBreadcrumb({
          category: "console",
          message: args.map(String).join(" "),
          level,
          data: { arguments: args },
        });
      } catch {
        // Silently ignore breadcrumb failures
      } finally {
        inBreadcrumb = false;
      }
    }

    console.log = (...args: unknown[]) => {
      safeBreadcrumb("debug", args);
      originalConsoleMethods!.log(...args);
    };

    console.info = (...args: unknown[]) => {
      safeBreadcrumb("info", args);
      originalConsoleMethods!.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      safeBreadcrumb("warning", args);
      originalConsoleMethods!.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      safeBreadcrumb("error", args);
      originalConsoleMethods!.error(...args);
    };

    // Track for cleanup
    cleanupFunctions.push(() => {
      if (originalConsoleMethods) {
        console.log = originalConsoleMethods.log;
        console.info = originalConsoleMethods.info;
        console.warn = originalConsoleMethods.warn;
        console.error = originalConsoleMethods.error;
        originalConsoleMethods = null;
      }
    });
  },
};

/**
 * Close the Bugwatch Node.js SDK and clean up all resources.
 *
 * This function:
 * 1. Flushes any pending events
 * 2. Removes all event handlers (uncaughtException, unhandledRejection)
 * 3. Restores original console methods if ConsoleIntegration was used
 * 4. Removes process exit handlers
 *
 * Call this before process exit if you need to ensure clean shutdown.
 */
export async function close(): Promise<void> {
  const client = getClient();
  if (client) {
    await client.close();
  }

  // Run all cleanup functions
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupFunctions = [];
}
