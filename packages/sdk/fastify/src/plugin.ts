import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  getClient,
  captureException,
  captureMessage as coreCaptureMessage,
  addBreadcrumb,
  setUser,
  flush,
  close,
  runWithContext,
  createScopedContext,
  type RequestContext,
  type BugwatchClient,
  type ScopedContext,
} from "@bugwatch/core";
import type { BugwatchFastifyOptions, BugwatchDecorator } from "./types";

/**
 * Headers that should be filtered out by default for security.
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "proxy-authorization",
]);

/**
 * Body fields that should be filtered out by default for security.
 */
const SENSITIVE_BODY_FIELDS = new Set([
  "password",
  "secret",
  "token",
  "api_key",
  "apiKey",
  "credit_card",
  "creditCard",
  "ssn",
  "social_security",
]);

/**
 * Default header filter function.
 */
function defaultHeaderFilter(name: string): boolean {
  return !SENSITIVE_HEADERS.has(name.toLowerCase());
}

/**
 * Default body field filter function.
 */
function defaultBodyFilter(key: string): boolean {
  return !SENSITIVE_BODY_FIELDS.has(key.toLowerCase());
}

/**
 * Filter an object's keys based on a filter function.
 */
function filterObject<T extends Record<string, unknown>>(
  obj: T,
  filter: (key: string, value: unknown) => boolean
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (filter(key, value)) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Extract request context from a Fastify request.
 */
function extractRequestContext(
  request: FastifyRequest,
  options: BugwatchFastifyOptions
): RequestContext {
  const headerFilter = options.filterHeaders || defaultHeaderFilter;
  const bodyFilter = options.filterBody || defaultBodyFilter;

  // Filter headers
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && headerFilter(name, value)) {
      headers[name] = value;
    } else if (Array.isArray(value)) {
      const filtered = value.filter((v) => headerFilter(name, v));
      if (filtered.length > 0) {
        headers[name] = filtered.join(", ");
      }
    }
  }

  const context: RequestContext = {
    url: request.url,
    method: request.method,
    headers,
    query_string: request.url.includes("?") ? request.url.split("?")[1] : undefined,
  };

  // Include body if requested and available
  if (options.includeBody && request.body && typeof request.body === "object") {
    context.data = filterObject(request.body as Record<string, unknown>, bodyFilter);
  }

  return context;
}

/**
 * Extract client IP from request.
 */
function extractClientIp(request: FastifyRequest): string | undefined {
  // Check common proxy headers
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp;

  const cfIp = request.headers["cf-connecting-ip"];
  if (typeof cfIp === "string") return cfIp;

  // Fall back to connection address
  return request.ip;
}

/**
 * Create Bugwatch decorator for a request.
 */
function createBugwatchDecorator(
  request: FastifyRequest,
  options: BugwatchFastifyOptions
): BugwatchDecorator {
  let eventId: string | undefined;
  const client = getClient();

  return {
    captureError(error: Error): string {
      if (!client) return "";

      const requestContext = extractRequestContext(request, options);
      const clientIp = extractClientIp(request);

      eventId = captureException(error, {
        request: requestContext,
        extra: {
          request: requestContext,
          ...(clientIp && { client_ip: clientIp }),
        },
        tags: {
          "http.method": request.method,
          "http.url": request.url,
        },
      });

      return eventId;
    },

    captureMessage(message: string, level: "debug" | "info" | "warning" | "error" = "info"): string {
      if (!client) return "";

      eventId = coreCaptureMessage(message, level);
      return eventId;
    },

    getEventId(): string | undefined {
      return eventId;
    },

    get client(): BugwatchClient | null {
      return client;
    },
  };
}

/**
 * Bugwatch plugin implementation.
 */
const bugwatchPluginImpl: FastifyPluginAsync<BugwatchFastifyOptions> = async (
  fastify,
  options
) => {
  const opts: BugwatchFastifyOptions = {
    addBreadcrumbs: true,
    captureErrors: true,
    includeBody: false,
    flushOnError: false,
    ...options,
  };

  // Store request start times
  const requestStartTimes = new WeakMap<FastifyRequest, number>();

  // Decorate requests with bugwatch
  fastify.decorateRequest("bugwatch", null);

  // onRequest hook — create scoped context and run the entire request lifecycle inside it.
  // We use runWithContext so that all downstream hooks and the route handler
  // can access the request-scoped context via getRequestContext().
  fastify.addHook("onRequest", (request, _reply, done) => {
    const client = getClient();
    if (!client) {
      return done();
    }

    // Store start time
    requestStartTimes.set(request, Date.now());

    // Create a request-scoped context for isolation
    const scopedContext: ScopedContext = createScopedContext();

    // Create and attach decorator
    request.bugwatch = createBugwatchDecorator(request, opts);

    // Extract and set user context in the scoped context (not globally!)
    if (opts.extractUser) {
      const user = opts.extractUser(request);
      if (user) {
        scopedContext.user = user;
      }
    }

    // Run done() inside the scoped context so that all downstream
    // hooks and route handlers inherit the AsyncLocalStorage context
    runWithContext(scopedContext, () => {
      // Add request breadcrumb within the scoped context
      if (opts.addBreadcrumbs) {
        addBreadcrumb({
          category: "http",
          message: `${request.method} ${request.url}`,
          level: "info",
          data: {
            method: request.method,
            url: request.url,
          },
        });
      }

      done();
    });
  });

  // onResponse hook - add completion breadcrumb
  fastify.addHook("onResponse", async (request, reply) => {
    if (!opts.addBreadcrumbs) return;

    const client = getClient();
    if (!client) return;

    const startTime = requestStartTimes.get(request);
    const duration = startTime ? Date.now() - startTime : undefined;

    addBreadcrumb({
      category: "http",
      message: `${request.method} ${request.url} -> ${reply.statusCode}`,
      level: reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warning" : "info",
      data: {
        method: request.method,
        url: request.url,
        status_code: reply.statusCode,
        ...(duration !== undefined && { duration_ms: duration }),
      },
    });
  });

  // onError hook - capture errors
  fastify.addHook("onError", async (request, _reply, error) => {
    if (!opts.captureErrors) return;

    const client = getClient();
    if (!client) return;

    // Capture the error
    request.bugwatch?.captureError(error);

    // Flush if requested
    if (opts.flushOnError) {
      await flush();
    }
  });

  // onClose hook - flush pending events on server shutdown
  fastify.addHook("onClose", async () => {
    await close();
  });
};

/**
 * Bugwatch Fastify plugin.
 *
 * This plugin automatically:
 * - Captures request context for errors
 * - Adds HTTP request breadcrumbs
 * - Reports unhandled errors to Bugwatch
 * - Provides `request.bugwatch` decorator for manual error capture
 *
 * @example
 * ```typescript
 * import Fastify from "fastify";
 * import { init } from "@bugwatch/core";
 * import { bugwatchPlugin } from "@bugwatch/fastify";
 *
 * // Initialize Bugwatch
 * init({ apiKey: "your-api-key" });
 *
 * const fastify = Fastify();
 *
 * // Register the plugin
 * await fastify.register(bugwatchPlugin, {
 *   extractUser: (request) => {
 *     // Extract user from your auth system
 *     return request.user ? { id: request.user.id } : null;
 *   },
 * });
 *
 * // Your routes
 * fastify.get("/", async (request, reply) => {
 *   return { hello: "world" };
 * });
 *
 * // Manual error capture
 * fastify.get("/risky", async (request, reply) => {
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
export const bugwatchPlugin = fp(bugwatchPluginImpl, {
  fastify: "4.x || 5.x",
  name: "@bugwatch/fastify",
});
