/**
 * One-liner setup for Bugwatch Express integration.
 *
 * This module provides a simplified setup function that handles all
 * initialization and middleware registration in a single call.
 */

import type { Express, Application } from "express";
import { init, getClient, type BugwatchOptions } from "@bugwatch/core";
import { requestHandler, errorHandler } from "./middleware";
import type { BugwatchExpressOptions } from "./types";

/**
 * Combined options for Express setup.
 * Includes both core SDK options and Express-specific middleware options.
 */
export interface BugwatchExpressSetupOptions
  extends BugwatchExpressOptions,
    Partial<BugwatchOptions> {}

/**
 * Result object returned by setup() for advanced use cases.
 */
export interface BugwatchSetupResult {
  /**
   * Manually add the error handler middleware.
   * Call this if you're not using app.listen() directly (e.g., http.createServer).
   *
   * @example
   * ```typescript
   * const { addErrorHandler } = setup(app);
   *
   * // Define your routes...
   *
   * // If not using app.listen(), manually add error handler after routes:
   * addErrorHandler();
   *
   * http.createServer(app).listen(3000);
   * ```
   */
  addErrorHandler: () => void;
}

// Track which apps have been set up to prevent double-setup
const setupApps = new WeakSet<Express | Application>();

// Mutex for thread-safe initialization
let initializationInProgress = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Thread-safe SDK initialization
 */
async function ensureInitialized(options?: Partial<BugwatchOptions>): Promise<void> {
  // Fast path: already initialized
  if (getClient()) {
    return;
  }

  // If initialization is in progress, wait for it
  if (initializationInProgress && initializationPromise) {
    await initializationPromise;
    return;
  }

  // Start initialization
  initializationInProgress = true;
  initializationPromise = (async () => {
    try {
      // Double-check after acquiring "lock"
      if (getClient()) {
        return;
      }

      // Extract core options
      const coreOptions: Partial<BugwatchOptions> = {};
      if (options?.apiKey) coreOptions.apiKey = options.apiKey;
      if (options?.endpoint) coreOptions.endpoint = options.endpoint;
      if (options?.environment) coreOptions.environment = options.environment;
      if (options?.release) coreOptions.release = options.release;
      if (options?.debug !== undefined) coreOptions.debug = options.debug;
      if (options?.sampleRate !== undefined) coreOptions.sampleRate = options.sampleRate;
      if (options?.maxBreadcrumbs !== undefined) coreOptions.maxBreadcrumbs = options.maxBreadcrumbs;
      if (options?.tags) coreOptions.tags = options.tags;
      if (options?.user) coreOptions.user = options.user;
      if (options?.beforeSend) coreOptions.beforeSend = options.beforeSend;
      if (options?.ignoreErrors) coreOptions.ignoreErrors = options.ignoreErrors;

      init(coreOptions);
    } finally {
      initializationInProgress = false;
    }
  })();

  await initializationPromise;
}

/**
 * Set up Bugwatch for an Express application with a single call.
 *
 * This function:
 * 1. Initializes the Bugwatch SDK (using env vars if no apiKey provided)
 * 2. Adds the request handler middleware immediately
 * 3. Hooks into app.listen() to add the error handler before the server starts
 *
 * **Important**: Call `setup()` early, before defining your routes, so the
 * request handler can capture context for all requests.
 *
 * @param app - The Express application instance
 * @param options - Configuration options (optional if BUGWATCH_API_KEY env var is set)
 * @returns Object with `addErrorHandler()` for manual error handler registration
 *
 * @example Basic usage (recommended)
 * ```typescript
 * import express from "express";
 * import { setup } from "@bugwatch/express";
 *
 * const app = express();
 *
 * // Call setup BEFORE defining routes
 * setup(app);
 *
 * app.get("/", (req, res) => res.send("Hello!"));
 *
 * // Error handler is automatically added when listen() is called
 * app.listen(3000);
 * ```
 *
 * @example With explicit options
 * ```typescript
 * setup(app, {
 *   apiKey: "bw_live_xxxxx",
 *   environment: "production",
 *   extractUser: (req) => ({ id: req.user?.id }),
 * });
 * ```
 *
 * @example With http.createServer (manual error handler)
 * ```typescript
 * import http from "http";
 * import express from "express";
 * import { setup } from "@bugwatch/express";
 *
 * const app = express();
 * const { addErrorHandler } = setup(app);
 *
 * app.get("/", (req, res) => res.send("Hello!"));
 *
 * // Manually add error handler AFTER routes
 * addErrorHandler();
 *
 * http.createServer(app).listen(3000);
 * ```
 */
export function setup(
  app: Express | Application,
  options?: BugwatchExpressSetupOptions
): BugwatchSetupResult {
  // Prevent double-setup
  if (setupApps.has(app)) {
    console.warn("[Bugwatch] setup() already called for this app. Skipping.");
    return {
      addErrorHandler: () => {
        // No-op for already-setup apps
      },
    };
  }
  setupApps.add(app);

  // Initialize core SDK with race condition protection
  // Note: This is async but we don't await it here to avoid breaking the sync API
  // The initialization will complete before any requests are handled
  ensureInitialized(options).catch((err) => {
    if (options?.debug) {
      console.error("[Bugwatch] Initialization failed:", err);
    }
  });

  // Extract middleware-specific options
  const middlewareOptions: BugwatchExpressOptions = {};
  if (options?.extractUser) middlewareOptions.extractUser = options.extractUser;
  if (options?.filterHeaders) middlewareOptions.filterHeaders = options.filterHeaders;
  if (options?.filterBody) middlewareOptions.filterBody = options.filterBody;
  if (options?.includeBody !== undefined) middlewareOptions.includeBody = options.includeBody;
  if (options?.addBreadcrumbs !== undefined) middlewareOptions.addBreadcrumbs = options.addBreadcrumbs;
  if (options?.flushOnError !== undefined) middlewareOptions.flushOnError = options.flushOnError;

  // Add request handler middleware early
  app.use(requestHandler(middlewareOptions));

  // Track whether error handler has been added
  let errorHandlerAdded = false;

  /**
   * Add the error handler middleware.
   * This should be called AFTER all routes are defined.
   */
  const addErrorHandler = (): void => {
    if (errorHandlerAdded) {
      return; // Already added, skip
    }
    errorHandlerAdded = true;
    app.use(errorHandler(middlewareOptions));
  };

  // Hook into app.listen to add error handler automatically
  const originalListen = app.listen.bind(app);

  (app as any).listen = function (
    ...args: Parameters<typeof originalListen>
  ): ReturnType<typeof originalListen> {
    // Add error handler before calling original listen
    addErrorHandler();

    // Restore original listen for any future calls
    (app as any).listen = originalListen;

    return originalListen(...args);
  };

  return { addErrorHandler };
}
