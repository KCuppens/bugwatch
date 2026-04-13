'use strict';

var node = require('@bugwatch/node');
var core = require('@bugwatch/core');

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  addBreadcrumb: () => core.addBreadcrumb,
  captureException: () => core.captureException,
  captureMessage: () => core.captureMessage,
  getClient: () => core.getClient,
  init: () => init,
  setExtra: () => core.setExtra,
  setTag: () => core.setTag,
  setUser: () => core.setUser,
  withBugwatch: () => withBugwatch,
  withBugwatchApi: () => withBugwatchApi,
  withBugwatchServerSideProps: () => withBugwatchServerSideProps,
  withBugwatchStaticProps: () => withBugwatchStaticProps
});
function init(options) {
  const mergedOptions = { ...DEFAULT_NEXTJS_OPTIONS, ...options };
  const client = node.init(mergedOptions);
  client.setTag("framework", "nextjs");
  client.setTag("next.runtime", getNextRuntime());
  if (mergedOptions.debug) {
    console.log("[Bugwatch] Next.js SDK initialized (server)");
  }
}
function getNextRuntime() {
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    return "edge";
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    return "nodejs";
  }
  return "nodejs";
}
function withBugwatch(bugwatchOptions) {
  return (nextConfig = {}) => {
    if (typeof window === "undefined" && bugwatchOptions.apiKey) {
      init(bugwatchOptions);
    }
    return {
      ...nextConfig,
      // Extend webpack config to add source map handling
      webpack: (config, options) => {
        if (!options.dev && !options.isServer) {
          config.devtool = "hidden-source-map";
        }
        if (typeof nextConfig.webpack === "function") {
          return nextConfig.webpack(config, options);
        }
        return config;
      }
    };
  };
}
function withBugwatchServerSideProps(getServerSideProps) {
  return async (context) => {
    try {
      return await getServerSideProps(context);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException2(error, {
          tags: {
            mechanism: "getServerSideProps",
            "next.route": context.resolvedUrl
          },
          request: {
            url: context.resolvedUrl,
            method: context.req.method,
            headers: sanitizeHeaders(context.req.headers)
          }
        });
      }
      throw error;
    }
  };
}
function withBugwatchStaticProps(getStaticProps) {
  return async (context) => {
    try {
      return await getStaticProps(context);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException2(error, {
          tags: {
            mechanism: "getStaticProps"
          }
        });
      }
      throw error;
    }
  };
}
function withBugwatchApi(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const { captureException: captureException2 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        const request = req;
        captureException2(error, {
          tags: {
            mechanism: "apiRoute"
          },
          request: {
            method: request.method,
            url: request.url,
            headers: sanitizeHeaders(request.headers || {})
          }
        });
      }
      throw error;
    }
  };
}
function sanitizeHeaders(headers) {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token"
  ];
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[Filtered]";
    } else if (value !== void 0) {
      sanitized[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return sanitized;
}
var DEFAULT_NEXTJS_OPTIONS;
var init_src = __esm({
  "src/index.ts"() {
    DEFAULT_NEXTJS_OPTIONS = {
      captureServerSideErrors: true,
      captureApiErrors: true,
      captureBuildErrors: true
    };
  }
});

// src/config.ts
function getEnvConfig() {
  const config = {};
  const apiKey = process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;
  if (apiKey) config.apiKey = apiKey;
  const environment = process.env.BUGWATCH_ENVIRONMENT || process.env.NEXT_PUBLIC_BUGWATCH_ENVIRONMENT;
  if (environment) config.environment = environment;
  const release = process.env.BUGWATCH_RELEASE || process.env.NEXT_PUBLIC_BUGWATCH_RELEASE;
  if (release) config.release = release;
  const debug = process.env.BUGWATCH_DEBUG || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG;
  if (debug === "true") config.debug = true;
  const endpoint = process.env.BUGWATCH_ENDPOINT || process.env.NEXT_PUBLIC_BUGWATCH_ENDPOINT;
  if (endpoint) config.endpoint = endpoint;
  return config;
}

// src/instrumentation.ts
var DEFAULT_OPTIONS = {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  captureConsoleErrors: true
};
var registered = false;
function reset() {
  registered = false;
}
function registerBugwatch(options = {}) {
  if (registered) {
    return;
  }
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const envConfig = getEnvConfig();
  const apiKey = mergedOptions.apiKey || envConfig.apiKey;
  const endpoint = mergedOptions.endpoint || envConfig.endpoint;
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] No API key provided. Set NEXT_PUBLIC_BUGWATCH_API_KEY environment variable."
      );
    }
    return;
  }
  const runtime = mergedOptions.runtime || detectRuntime();
  if (runtime === "edge") {
    initEdge(apiKey, endpoint, mergedOptions);
  } else {
    initNode(apiKey, endpoint, mergedOptions);
  }
  registered = true;
}
function detectRuntime() {
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    return "edge";
  }
  return "nodejs";
}
function initNode(apiKey, endpoint, options) {
  const { init: init2 } = (init_src(), __toCommonJS(src_exports));
  init2({
    apiKey,
    ...endpoint && { endpoint },
    environment: process.env.NODE_ENV || "production",
    debug: options.debug || process.env.BUGWATCH_DEBUG === "true",
    captureUncaughtExceptions: options.captureUncaughtExceptions,
    captureUnhandledRejections: options.captureUnhandledRejections
  });
  if (options.captureConsoleErrors !== false) {
    setupConsoleErrorCapture();
  }
  if (options.debug || process.env.BUGWATCH_DEBUG === "true") {
    console.log("[Bugwatch] Server-side tracking initialized (Node.js runtime)");
  }
}
function initEdge(apiKey, endpoint, options) {
  const { init: init2 } = __require("@bugwatch/core");
  init2({
    apiKey,
    ...endpoint && { endpoint },
    environment: process.env.NODE_ENV || "production",
    debug: options.debug || process.env.BUGWATCH_DEBUG === "true"
  });
  if (options.debug || process.env.BUGWATCH_DEBUG === "true") {
    console.log("[Bugwatch] Server-side tracking initialized (Edge runtime)");
  }
}
function setupConsoleErrorCapture() {
  const originalConsoleError = console.error;
  let inCapture = false;
  console.error = (...args) => {
    originalConsoleError.apply(console, args);
    if (inCapture) return;
    inCapture = true;
    try {
      const { captureException: captureException2, captureMessage: captureMessage2, getClient: getClient2 } = __require("@bugwatch/core");
      if (!getClient2()) return;
      const error = args.find((arg) => arg instanceof Error);
      if (error) {
        const message = String(args[0] || "");
        if (message.startsWith("[Bugwatch]")) return;
        captureException2(error, {
          level: "warning",
          tags: { mechanism: "console.error" },
          extra: {
            console_args: args.filter((a) => !(a instanceof Error)).map((a) => {
              try {
                return String(a);
              } catch {
                return "[unstringifiable]";
              }
            }).join(" ") || void 0
          }
        });
      } else {
        const text = args.map((a) => {
          try {
            return String(a);
          } catch {
            return "[unstringifiable]";
          }
        }).join(" ");
        if (text.startsWith("[Bugwatch]") || text.startsWith("Warning:") || text.startsWith("\u26A0") || text.includes("Fast Refresh") || text.includes("next-dev.js")) return;
        const lowerText = text.toLowerCase();
        if (lowerText.includes("error") || lowerText.includes("failed") || lowerText.includes("exception") || lowerText.includes("timeout") || lowerText.includes("eacces") || lowerText.includes("enoent") || lowerText.includes("econnrefused")) {
          captureMessage2(text.slice(0, 1e3), "warning");
        }
      }
    } catch {
    } finally {
      inCapture = false;
    }
  };
}
function isRegistered() {
  return registered;
}
async function onRequestError(err, request, context) {
  const { captureException: captureException2, getClient: getClient2 } = await import('@bugwatch/core');
  captureException2(err, {
    level: "error",
    tags: {
      mechanism: "nextjs.onRequestError",
      "next.routerKind": context.routerKind,
      "next.routePath": context.routePath,
      "next.routeType": context.routeType,
      ...context.renderSource && { "next.renderSource": context.renderSource },
      ...err.digest && { "next.digest": err.digest }
    },
    request: {
      url: request.path,
      method: request.method,
      headers: sanitizeHeaders2(request.headers)
    }
  });
  const client = getClient2();
  if (client) {
    await client.flush().catch(() => {
    });
  }
}
function sanitizeHeaders2(headers) {
  const sensitiveKeys = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token"
  ];
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = "[Filtered]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

exports.isRegistered = isRegistered;
exports.onRequestError = onRequestError;
exports.registerBugwatch = registerBugwatch;
exports.reset = reset;
//# sourceMappingURL=instrumentation.js.map
//# sourceMappingURL=instrumentation.js.map