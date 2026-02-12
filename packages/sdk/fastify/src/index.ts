/**
 * @bugwatch/fastify - Fastify integration for Bugwatch
 *
 * This package provides a plugin for automatically capturing errors
 * and request context in Fastify applications.
 *
 * @example One-liner setup (recommended)
 * ```typescript
 * import Fastify from "fastify";
 * import { setup } from "@bugwatch/fastify";
 *
 * const fastify = Fastify();
 *
 * // Single call handles everything (uses BUGWATCH_API_KEY env var)
 * await setup(fastify);
 *
 * // Or with explicit options
 * await setup(fastify, {
 *   apiKey: "bw_live_xxxxx",
 *   extractUser: (request) => ({ id: request.user?.id }),
 * });
 *
 * fastify.get("/", async () => ({ hello: "world" }));
 *
 * await fastify.listen({ port: 3000 });
 * ```
 *
 * @example Manual setup (for more control)
 * ```typescript
 * import Fastify from "fastify";
 * import { init } from "@bugwatch/core";
 * import { bugwatchPlugin } from "@bugwatch/fastify";
 *
 * init({ apiKey: "your-api-key" });
 *
 * const fastify = Fastify();
 * await fastify.register(bugwatchPlugin);
 *
 * // request.bugwatch is available for manual capture
 * fastify.get("/risky", async (request) => {
 *   try {
 *     await riskyOperation();
 *   } catch (err) {
 *     request.bugwatch.captureError(err);
 *     return { error: "Something went wrong" };
 *   }
 * });
 *
 * await fastify.listen({ port: 3000 });
 * ```
 */

// Export one-liner setup
export { setup } from "./setup";
export type { BugwatchFastifySetupOptions } from "./setup";

// Export plugin
export { bugwatchPlugin } from "./plugin";

// Export types
export type {
  BugwatchFastifyOptions,
  BugwatchDecorator,
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
