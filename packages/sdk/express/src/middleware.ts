import { isIP } from "net";
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from "express";
import {
  getClient,
  captureException,
  addBreadcrumb,
  flush,
  runWithContext,
  createScopedContext,
  type RequestContext,
  type ScopedContext,
} from "@bugwatch/core";
import type { BugwatchExpressOptions, BugwatchRequest, AsyncRequestHandler } from "./types";

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
 * Extract request context from an Express request.
 */
function extractRequestContext(
  req: Request,
  options: BugwatchExpressOptions
): RequestContext {
  const headerFilter = options.filterHeaders || defaultHeaderFilter;
  const bodyFilter = options.filterBody || defaultBodyFilter;

  // Filter headers
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && headerFilter(name, value)) {
      headers[name] = value;
    } else if (Array.isArray(value)) {
      const filtered = value.filter((v) => headerFilter(name, v));
      if (filtered.length > 0) {
        headers[name] = filtered.join(", ");
      }
    }
  }

  // Use req.hostname (respects trust proxy) instead of req.get('host') (user-controlled)
  // to prevent Host header injection into captured event URLs.
  const context: RequestContext = {
    url: `${req.protocol}://${req.hostname}${req.originalUrl}`,
    method: req.method,
    headers,
    query_string: req.url.includes("?") ? req.url.split("?")[1] : undefined,
  };

  // Include body if requested and available
  if (options.includeBody && req.body && typeof req.body === "object") {
    context.data = filterObject(req.body, bodyFilter);
  }

  return context;
}

// Validate IP address format — rejects injected strings from forged headers
function isValidIp(ip: string): boolean {
  return isIP(ip) !== 0;
}

/**
 * Extract client IP from request.
 */
function extractClientIp(req: Request): string | undefined {
  // Check common proxy headers
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp && isValidIp(firstIp)) return firstIp;
  }

  const realIp = req.get("x-real-ip");
  if (realIp && isValidIp(realIp)) return realIp;

  const cfIp = req.get("cf-connecting-ip");
  if (cfIp && isValidIp(cfIp)) return cfIp;

  // Fall back to socket address (trusted — not from headers)
  return req.socket.remoteAddress;
}

/**
 * Request handler middleware that adds request context and breadcrumbs.
 *
 * This middleware should be added early in your middleware chain.
 * Uses AsyncLocalStorage for request-scoped context isolation to prevent
 * user context leakage between concurrent requests.
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { requestHandler } from "@bugwatch/express";
 *
 * const app = express();
 * app.use(requestHandler());
 * ```
 */
export function requestHandler(
  options: BugwatchExpressOptions = {}
): RequestHandler {
  return (req: BugwatchRequest, res: Response, next: NextFunction) => {
    const client = getClient();
    if (!client) {
      return next();
    }

    // Create a request-scoped context for isolation
    const scopedContext: ScopedContext = createScopedContext();

    // Generate a per-request correlation ID for end-to-end tracing
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Store start time and request ID for downstream access
    req.bugwatch = { startTime: Date.now(), requestId };

    // Extract and set user context in the scoped context
    if (options.extractUser) {
      try {
        const user = options.extractUser(req);
        if (user) {
          scopedContext.user = user;
        }
      } catch {
        // Never let user extraction crash the request
      }
    }

    // Run the rest of the request handling within the isolated context
    runWithContext(scopedContext, () => {
      // Add request start breadcrumb with correlation ID
      if (options.addBreadcrumbs !== false) {
        addBreadcrumb({
          category: "http",
          message: `${req.method} ${req.path}`,
          level: "info",
          data: {
            method: req.method,
            url: req.originalUrl,
            request_id: requestId,
          },
        });
      }

      // Track response for completion breadcrumb
      const originalEnd = res.end.bind(res);
      res.end = function (...args: Parameters<Response["end"]>) {
        // Re-enter the request-scoped context so the breadcrumb attaches to the
        // correct request, not the global scope (res.end fires after runWithContext exits)
        try {
          if (options.addBreadcrumbs !== false) {
            const duration = Date.now() - (req.bugwatch?.startTime || Date.now());
            runWithContext(scopedContext, () => {
              addBreadcrumb({
                category: "http",
                message: `${req.method} ${req.path} -> ${res.statusCode}`,
                level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warning" : "info",
                data: {
                  method: req.method,
                  url: req.originalUrl,
                  status_code: res.statusCode,
                  duration_ms: duration,
                  request_id: requestId,
                },
              });
            });
          }
        } catch {
          // Never let SDK code break response sending
        }
        return originalEnd(...args);
      } as Response["end"];

      next();
    });
  };
}

/**
 * Error handler middleware that captures errors to Bugwatch.
 *
 * This middleware should be added after all your routes.
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { requestHandler, errorHandler } from "@bugwatch/express";
 *
 * const app = express();
 * app.use(requestHandler());
 *
 * // ... your routes ...
 *
 * app.use(errorHandler());
 * ```
 */
export function errorHandler(
  options: BugwatchExpressOptions = {}
): ErrorRequestHandler {
  return async (
    err: unknown,
    req: BugwatchRequest,
    _res: Response,
    next: NextFunction
  ) => {
    const client = getClient();
    if (!client) {
      return next(err);
    }

    try {
      // Normalize non-Error objects to Error instances
      const error = err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : JSON.stringify(err));
      if (!(err instanceof Error)) {
        error.name = "NonErrorException";
      }

      // Build request context (wrapped to prevent extraction errors from losing the event)
      let requestContext: RequestContext;
      try {
        requestContext = extractRequestContext(req, options);
      } catch {
        requestContext = { url: req.originalUrl, method: req.method };
      }

      // Build extra context (request context is already at the top-level, so only include non-error original here)
      const extra: Record<string, unknown> = {};

      // If the original thrown value was not an Error, include it as extra data
      if (!(err instanceof Error)) {
        extra.originalValue = err;
      }

      // Resolve IP into user.ip_address (server field) so it surfaces in the User card
      let clientIp: string | undefined;
      try {
        clientIp = extractClientIp(req);
      } catch {
        // Ignore IP extraction errors
      }

      // Capture the error
      const eventId = captureException(error, {
        request: requestContext,
        extra,
        ...(clientIp && { user: { ip_address: clientIp } }),
        tags: {
          "http.method": req.method,
          "http.url": req.originalUrl,
        },
      });

      // Store event ID for reference
      if (req.bugwatch) {
        req.bugwatch.eventId = eventId;
      }

      // Flush if requested (useful for serverless)
      if (options.flushOnError) {
        await flush();
      }
    } catch {
      // Never let error capture break the error handling chain
    }

    // Pass to next error handler (pass original value, not normalized)
    next(err);
  };
}

/**
 * Wrap an async request handler to automatically capture errors.
 *
 * @example
 * ```typescript
 * import { wrapHandler } from "@bugwatch/express";
 *
 * app.get("/users/:id", wrapHandler(async (req, res) => {
 *   const user = await getUserById(req.params.id);
 *   res.json(user);
 * }));
 * ```
 */
export function wrapHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Manually capture an error with Express request context.
 *
 * @example
 * ```typescript
 * import { captureError } from "@bugwatch/express";
 *
 * app.get("/users/:id", (req, res) => {
 *   try {
 *     const user = getUserById(req.params.id);
 *     res.json(user);
 *   } catch (err) {
 *     captureError(req, err);
 *     res.status(500).json({ error: "Internal server error" });
 *   }
 * });
 * ```
 */
export function captureError(
  req: Request,
  error: Error,
  options: BugwatchExpressOptions = {}
): string {
  const client = getClient();
  if (!client) {
    return "";
  }

  const requestContext = extractRequestContext(req, options);
  const clientIp = extractClientIp(req);

  return captureException(error, {
    request: requestContext,
    ...(clientIp && { user: { ip_address: clientIp } }),
    tags: {
      "http.method": req.method,
      "http.url": req.originalUrl,
    },
  });
}

/**
 * Get the Bugwatch request ID for the current request.
 * Include this in response headers (e.g. X-Request-Id) for end-to-end tracing.
 *
 * @example
 * ```typescript
 * app.use(requestHandler());
 * app.use((req, res, next) => {
 *   const id = getRequestId(req);
 *   if (id) res.setHeader('X-Request-Id', id);
 *   next();
 * });
 * ```
 */
export function getRequestId(req: Request): string | undefined {
  return (req as BugwatchRequest).bugwatch?.requestId;
}
