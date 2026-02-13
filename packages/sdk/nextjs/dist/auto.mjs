import { init as init$1 } from '@bugwatch/node';
import { setUser, setTag, setExtra, getClient, captureMessage, captureException, addBreadcrumb, init as init$2 } from '@bugwatch/core';
import { useEffect, Component } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
function hasApiKey() {
  return Boolean(process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY);
}
var init_config = __esm({
  "src/config.ts"() {
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  addBreadcrumb: () => addBreadcrumb,
  captureException: () => captureException,
  captureMessage: () => captureMessage,
  getClient: () => getClient,
  init: () => init,
  setExtra: () => setExtra,
  setTag: () => setTag,
  setUser: () => setUser,
  withBugwatch: () => withBugwatch,
  withBugwatchApi: () => withBugwatchApi,
  withBugwatchServerSideProps: () => withBugwatchServerSideProps,
  withBugwatchStaticProps: () => withBugwatchStaticProps
});
function init(options) {
  const mergedOptions = { ...DEFAULT_NEXTJS_OPTIONS, ...options };
  const client = init$1(mergedOptions);
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
      const { captureException: captureException4 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException4(error, {
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
      const { captureException: captureException4 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        captureException4(error, {
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
      const { captureException: captureException4 } = await import('@bugwatch/core');
      if (error instanceof Error) {
        const request = req;
        captureException4(error, {
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

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  BugwatchErrorBoundary: () => BugwatchErrorBoundary,
  BugwatchProvider: () => BugwatchProvider,
  addBreadcrumb: () => addBreadcrumb,
  captureException: () => captureException,
  captureMessage: () => captureMessage,
  closeClient: () => closeClient,
  initClient: () => initClient,
  setExtra: () => setExtra,
  setTag: () => setTag,
  setUser: () => setUser
});
function initClient(options) {
  if (typeof window === "undefined") {
    return;
  }
  if (isClientInitialized) {
    return;
  }
  const mergedOptions = { ...DEFAULT_CLIENT_OPTIONS, ...options };
  try {
    init$2(mergedOptions);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client initialization failed:", err);
    }
    return;
  }
  const client = getClient();
  if (client) {
    client.setTag("runtime", "browser");
    client.setTag("browser.userAgent", navigator.userAgent);
  }
  if (mergedOptions.captureGlobalErrors) {
    const cleanup = setupGlobalErrorHandler();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  if (mergedOptions.captureUnhandledRejections) {
    const cleanup = setupUnhandledRejectionHandler();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  if (mergedOptions.captureConsoleBreadcrumbs) {
    const cleanup = setupConsoleBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  if (mergedOptions.captureClickBreadcrumbs) {
    const cleanup = setupClickBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  if (mergedOptions.captureNavigationBreadcrumbs) {
    const cleanup = setupNavigationBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  if (mergedOptions.captureHttpErrors) {
    const cleanup = setupFetchInstrumentation(mergedOptions);
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }
  isClientInitialized = true;
  if (mergedOptions.debug) {
    console.log("[Bugwatch] Client SDK initialized");
  }
}
function closeClient() {
  for (const cleanup of clientCleanupFunctions) {
    try {
      cleanup();
    } catch {
    }
  }
  clientCleanupFunctions = [];
  isClientInitialized = false;
}
function setupGlobalErrorHandler() {
  const originalOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (error && !error.__bugwatch_captured) {
      captureException(error, {
        tags: { mechanism: "onerror" }
      });
    }
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };
  return () => {
    window.onerror = originalOnError;
  };
}
function setupUnhandledRejectionHandler() {
  const handler = (event) => {
    if (event.reason && event.reason.__bugwatch_captured) {
      return;
    }
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    captureException(error, {
      tags: { mechanism: "onunhandledrejection" }
    });
  };
  window.addEventListener("unhandledrejection", handler);
  return () => {
    window.removeEventListener("unhandledrejection", handler);
  };
}
function setupConsoleBreadcrumbs() {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };
  const wrap = (method, level) => {
    console[method] = (...args) => {
      addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level
      });
      originalConsole[method](...args);
    };
  };
  wrap("log", "debug");
  wrap("debug", "debug");
  wrap("info", "info");
  wrap("warn", "warning");
  wrap("error", "error");
  return () => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  };
}
function setupClickBreadcrumbs() {
  const handler = (event) => {
    const target = event.target;
    if (!target) return;
    const tagName = target.tagName?.toLowerCase();
    const id = target.id ? `#${target.id}` : "";
    const className = target.className ? `.${String(target.className).split(" ").join(".")}` : "";
    const text = target.textContent?.slice(0, 50) || "";
    addBreadcrumb({
      category: "ui.click",
      message: `${tagName}${id}${className}${text ? ` "${text}"` : ""}`,
      level: "info"
    });
  };
  document.addEventListener("click", handler, { capture: true });
  return () => {
    document.removeEventListener("click", handler, { capture: true });
  };
}
function setupNavigationBreadcrumbs() {
  addBreadcrumb({
    category: "navigation",
    message: window.location.href,
    level: "info",
    data: { from: document.referrer || void 0 }
  });
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info"
    });
    return result;
  };
  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info"
    });
    return result;
  };
  const popstateHandler = () => {
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info"
    });
  };
  window.addEventListener("popstate", popstateHandler);
  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", popstateHandler);
  };
}
function setupFetchInstrumentation(options) {
  const originalFetch = window.fetch;
  const sdkEndpoint = options.endpoint || "https://api.bugwatch.dev";
  const sdkEventUrl = `${sdkEndpoint}/api/v1/events`;
  window.fetch = async function(input, init2) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init2?.method || "GET";
    if (url.startsWith(sdkEventUrl)) {
      return originalFetch.call(window, input, init2);
    }
    const startTime = Date.now();
    try {
      const response = await originalFetch.call(window, input, init2);
      const duration = Date.now() - startTime;
      addBreadcrumb({
        category: "http",
        message: `${method.toUpperCase()} ${url}`,
        level: response.ok ? "info" : "warning",
        data: {
          method: method.toUpperCase(),
          url,
          status_code: response.status,
          duration_ms: duration
        }
      });
      if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
        const error = new Error(`HTTP ${response.status}: ${method.toUpperCase()} ${url}`);
        error.name = "HttpError";
        captureException(error, {
          level: response.status >= 500 ? "error" : "warning",
          tags: {
            mechanism: "fetch",
            "http.method": method.toUpperCase(),
            "http.status_code": String(response.status),
            "http.url": url
          }
        });
      }
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      addBreadcrumb({
        category: "http",
        message: `${method.toUpperCase()} ${url} (network error)`,
        level: "error",
        data: {
          method: method.toUpperCase(),
          url,
          duration_ms: duration,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      const networkError = error instanceof Error ? error : new Error(String(error));
      networkError.name = networkError.name || "NetworkError";
      captureException(networkError, {
        level: "error",
        tags: {
          mechanism: "fetch",
          "http.method": method.toUpperCase(),
          "http.url": url
        }
      });
      if (error instanceof Error) {
        error.__bugwatch_captured = true;
      }
      throw error;
    }
  };
  return () => {
    window.fetch = originalFetch;
  };
}
function BugwatchProvider({
  options,
  children
}) {
  useEffect(() => {
    const envConfig = getEnvConfig();
    const mergedOptions = { ...DEFAULT_CLIENT_OPTIONS, ...envConfig, ...options };
    if (!mergedOptions.apiKey) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Bugwatch] No API key provided. Set NEXT_PUBLIC_BUGWATCH_API_KEY env var or pass options.apiKey");
      }
      return;
    }
    initClient(mergedOptions);
  }, [options]);
  return /* @__PURE__ */ jsx(BugwatchErrorBoundary, { children });
}
var DEFAULT_CLIENT_OPTIONS, isClientInitialized, clientCleanupFunctions, BugwatchErrorBoundary;
var init_client = __esm({
  "src/client.tsx"() {
    "use client";
    init_config();
    DEFAULT_CLIENT_OPTIONS = {
      captureGlobalErrors: true,
      captureUnhandledRejections: true,
      captureConsoleBreadcrumbs: true,
      captureClickBreadcrumbs: true,
      captureNavigationBreadcrumbs: true,
      captureHttpErrors: true
    };
    isClientInitialized = false;
    clientCleanupFunctions = [];
    BugwatchErrorBoundary = class extends Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        captureException(error, {
          tags: { mechanism: "react.errorBoundary" },
          extra: {
            componentStack: errorInfo.componentStack
          }
        });
        this.props.onError?.(error, errorInfo);
      }
      render() {
        if (this.state.hasError && this.state.error) {
          const { fallback } = this.props;
          if (typeof fallback === "function") {
            return fallback(this.state.error);
          }
          if (fallback) {
            return fallback;
          }
          return /* @__PURE__ */ jsxs("div", { style: { padding: 20 }, children: [
            /* @__PURE__ */ jsx("h2", { children: "Something went wrong" }),
            /* @__PURE__ */ jsxs("details", { children: [
              /* @__PURE__ */ jsx("summary", { children: "Error details" }),
              /* @__PURE__ */ jsx("pre", { children: this.state.error.message })
            ] })
          ] });
        }
        return this.props.children;
      }
    };
  }
});

// src/auto.ts
init_config();
var initialized = false;
function autoInit() {
  if (initialized) return;
  if (!hasApiKey()) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Bugwatch] No API key found. Set BUGWATCH_API_KEY (server) or NEXT_PUBLIC_BUGWATCH_API_KEY (client)."
      );
    }
    return;
  }
  const envConfig = getEnvConfig();
  if (typeof window === "undefined") {
    initServer(envConfig);
  } else {
    initClient2(envConfig);
  }
  initialized = true;
}
function initServer(envConfig) {
  try {
    const { init: init2 } = (init_src(), __toCommonJS(src_exports));
    init2({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production"
    });
    if (process.env.NODE_ENV === "development" || process.env.BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Server SDK auto-initialized");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Server SDK initialization failed:", err);
    }
  }
}
function initClient2(envConfig) {
  try {
    const { initClient: initClientSdk } = (init_client(), __toCommonJS(client_exports));
    initClientSdk({
      ...envConfig,
      environment: envConfig.environment || process.env.NODE_ENV || "production"
    });
    if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG) {
      console.log("[Bugwatch] Client SDK auto-initialized");
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client SDK initialization failed:", err);
    }
  }
}
function isInitialized() {
  return initialized;
}
function ensureInitialized() {
  autoInit();
}
function reset() {
  initialized = false;
}
autoInit();

export { ensureInitialized, isInitialized, reset };
//# sourceMappingURL=auto.mjs.map
//# sourceMappingURL=auto.mjs.map