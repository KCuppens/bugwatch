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
}

const DEFAULT_NODE_OPTIONS: Partial<NodeOptions> = {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  exitOnUncaughtException: true,
  shutdownTimeout: 2000,
};

let uncaughtExceptionHandler: ((err: Error) => void) | null = null;
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
  const mergedOptions = { ...DEFAULT_NODE_OPTIONS, ...options };

  // Initialize core SDK
  const client = coreInit(mergedOptions);

  // Add runtime info
  client.setTag("runtime", "node");
  client.setTag("runtime.version", process.version);

  // Add OS info
  client.setTag("os.platform", process.platform);
  client.setTag("os.arch", process.arch);

  // Set up process error handlers
  if (mergedOptions.captureUncaughtExceptions) {
    setupUncaughtExceptionHandler(client, mergedOptions);
  }

  if (mergedOptions.captureUnhandledRejections) {
    setupUnhandledRejectionHandler(client);
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

  uncaughtExceptionHandler = (err: Error) => {
    client.captureException(err, {
      level: "fatal",
      tags: { mechanism: "uncaughtException" },
    });

    if (options.debug) {
      console.error("[Bugwatch] Captured uncaught exception:", err);
    }

    // Flush pending events then exit
    if (options.exitOnUncaughtException) {
      const timeout = options.shutdownTimeout || 2000;

      // Race: flush vs timeout — whichever finishes first
      const flushPromise = client.flush().catch(() => {
        // Ignore flush errors during shutdown
      });
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeout));

      Promise.race([flushPromise, timeoutPromise]).then(() => {
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

  sigintHandler = () => {
    const client = getClient();
    if (client) {
      client.flush().catch(() => {}).finally(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  sigtermHandler = () => {
    const client = getClient();
    if (client) {
      client.flush().catch(() => {}).finally(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

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
 * Express error handler middleware
 */
export function expressErrorHandler() {
  return (
    err: Error,
    req: { method?: string; url?: string; headers?: Record<string, string> },
    res: { statusCode?: number },
    next: (err?: Error) => void
  ) => {
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
      if (client && error instanceof Error) {
        client.captureException(error);
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
    "x-api-key",
    "x-auth-token",
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

    console.log = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "debug",
      });
      originalConsoleMethods!.log(...args);
    };

    console.info = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "info",
      });
      originalConsoleMethods!.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "warning",
      });
      originalConsoleMethods!.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "error",
      });
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
