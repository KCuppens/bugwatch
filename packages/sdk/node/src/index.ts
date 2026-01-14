import {
  init as coreInit,
  getClient,
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

    // Give time for event to be sent
    if (options.exitOnUncaughtException) {
      setTimeout(() => {
        process.exit(1);
      }, options.shutdownTimeout || 2000);
    }
  };

  process.on("uncaughtException", uncaughtExceptionHandler);
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
  };

  process.on("unhandledRejection", unhandledRejectionHandler);
}

/**
 * Set up process exit handler for cleanup
 */
function setupExitHandler(): void {
  const cleanup = () => {
    // Could flush any pending events here
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
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
 * Node.js console integration for breadcrumbs
 */
export const ConsoleIntegration: Integration = {
  name: "Console",
  setup(client: BugwatchClient) {
    const originalConsole = {
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
      originalConsole.log(...args);
    };

    console.info = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "info",
      });
      originalConsole.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "warning",
      });
      originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      client.addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "error",
      });
      originalConsole.error(...args);
    };
  },
};
