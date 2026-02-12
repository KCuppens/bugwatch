/**
 * @bugwatch/express - Express.js integration for Bugwatch
 *
 * This package provides middleware for automatically capturing errors
 * and request context in Express.js applications.
 *
 * @example One-liner setup (recommended)
 * ```typescript
 * import express from "express";
 * import { setup } from "@bugwatch/express";
 *
 * const app = express();
 *
 * // Single call handles everything (uses BUGWATCH_API_KEY env var)
 * setup(app);
 *
 * // Or with explicit options
 * setup(app, {
 *   apiKey: "bw_live_xxxxx",
 *   extractUser: (req) => ({ id: req.user?.id }),
 * });
 *
 * app.get("/", (req, res) => res.send("Hello World!"));
 *
 * app.listen(3000);
 * ```
 *
 * @example Manual setup (for more control)
 * ```typescript
 * import express from "express";
 * import { init } from "@bugwatch/core";
 * import { requestHandler, errorHandler } from "@bugwatch/express";
 *
 * init({ apiKey: "your-api-key" });
 *
 * const app = express();
 * app.use(requestHandler());
 *
 * // Your routes...
 *
 * app.use(errorHandler());
 * app.listen(3000);
 * ```
 */

// Export one-liner setup
export { setup } from "./setup";
export type { BugwatchExpressSetupOptions, BugwatchSetupResult } from "./setup";

// Export middleware functions
export {
  requestHandler,
  errorHandler,
  wrapHandler,
  captureError,
} from "./middleware";

// Export types
export type {
  BugwatchExpressOptions,
  BugwatchRequest,
  AsyncRequestHandler,
} from "./types";

// Re-export core functions for convenience
export {
  init,
  getClient,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  flush,
  close,
} from "@bugwatch/core";
