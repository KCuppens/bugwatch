/**
 * One-liner setup for Bugwatch Fastify integration.
 *
 * This module provides a simplified setup function that handles all
 * initialization and plugin registration in a single call.
 */

import type { FastifyInstance } from "fastify";
import { init, getClient, type BugwatchOptions } from "@bugwatch/core";
import { bugwatchPlugin } from "./plugin";
import type { BugwatchFastifyOptions } from "./types";

/**
 * Combined options for Fastify setup.
 * Includes both core SDK options and Fastify-specific plugin options.
 */
export interface BugwatchFastifySetupOptions
  extends BugwatchFastifyOptions,
    Partial<BugwatchOptions> {}

/**
 * Set up Bugwatch for a Fastify application with a single call.
 *
 * This function:
 * 1. Initializes the Bugwatch SDK (using env vars if no apiKey provided)
 * 2. Registers the Bugwatch plugin with the Fastify instance
 *
 * @param fastify - The Fastify instance
 * @param options - Configuration options (optional if BUGWATCH_API_KEY env var is set)
 * @returns Promise that resolves when the plugin is registered
 *
 * @example
 * ```typescript
 * import Fastify from "fastify";
 * import { setup } from "@bugwatch/fastify";
 *
 * const fastify = Fastify();
 *
 * // Minimal setup (uses BUGWATCH_API_KEY env var)
 * await setup(fastify);
 *
 * // Or with explicit options
 * await setup(fastify, {
 *   apiKey: "bw_live_xxxxx",
 *   environment: "production",
 *   extractUser: (request) => ({ id: request.user?.id }),
 * });
 *
 * fastify.get("/", async () => ({ hello: "world" }));
 *
 * await fastify.listen({ port: 3000 });
 * ```
 */
export async function setup(
  fastify: FastifyInstance,
  options?: BugwatchFastifySetupOptions
): Promise<void> {
  // Initialize core SDK if not already initialized
  if (!getClient()) {
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
  }

  // Extract plugin-specific options
  const pluginOptions: BugwatchFastifyOptions = {};
  if (options?.extractUser) pluginOptions.extractUser = options.extractUser;
  if (options?.filterHeaders) pluginOptions.filterHeaders = options.filterHeaders;
  if (options?.filterBody) pluginOptions.filterBody = options.filterBody;
  if (options?.includeBody !== undefined) pluginOptions.includeBody = options.includeBody;
  if (options?.addBreadcrumbs !== undefined) pluginOptions.addBreadcrumbs = options.addBreadcrumbs;
  if (options?.captureErrors !== undefined) pluginOptions.captureErrors = options.captureErrors;
  if (options?.flushOnError !== undefined) pluginOptions.flushOnError = options.flushOnError;

  // Register the plugin
  await fastify.register(bugwatchPlugin, pluginOptions);
}
