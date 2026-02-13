'use strict';

var react = require('react');
var core = require('@bugwatch/core');
var jsxRuntime = require('react/jsx-runtime');

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
var DEFAULT_CLIENT_OPTIONS = {
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  captureConsoleBreadcrumbs: true,
  captureClickBreadcrumbs: true,
  captureNavigationBreadcrumbs: true,
  captureHttpErrors: true
};
var isClientInitialized = false;
var clientCleanupFunctions = [];
function initClient(options) {
  if (typeof window === "undefined") {
    return;
  }
  if (isClientInitialized) {
    return;
  }
  const mergedOptions = { ...DEFAULT_CLIENT_OPTIONS, ...options };
  try {
    core.init(mergedOptions);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Bugwatch] Client initialization failed:", err);
    }
    return;
  }
  const client = core.getClient();
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
      core.captureException(error, {
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
    core.captureException(error, {
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
      core.addBreadcrumb({
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
    core.addBreadcrumb({
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
  core.addBreadcrumb({
    category: "navigation",
    message: window.location.href,
    level: "info",
    data: { from: document.referrer || void 0 }
  });
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    core.addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info"
    });
    return result;
  };
  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    core.addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info"
    });
    return result;
  };
  const popstateHandler = () => {
    core.addBreadcrumb({
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
  window.fetch = async function(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";
    if (url.startsWith(sdkEventUrl)) {
      return originalFetch.call(window, input, init);
    }
    const startTime = Date.now();
    try {
      const response = await originalFetch.call(window, input, init);
      const duration = Date.now() - startTime;
      core.addBreadcrumb({
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
        core.captureException(error, {
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
      core.addBreadcrumb({
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
      core.captureException(networkError, {
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
var BugwatchErrorBoundary = class extends react.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    core.captureException(error, {
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
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { padding: 20 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "Something went wrong" }),
        /* @__PURE__ */ jsxRuntime.jsxs("details", { children: [
          /* @__PURE__ */ jsxRuntime.jsx("summary", { children: "Error details" }),
          /* @__PURE__ */ jsxRuntime.jsx("pre", { children: this.state.error.message })
        ] })
      ] });
    }
    return this.props.children;
  }
};
function BugwatchProvider({
  options,
  children
}) {
  react.useEffect(() => {
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
  return /* @__PURE__ */ jsxRuntime.jsx(BugwatchErrorBoundary, { children });
}

Object.defineProperty(exports, "addBreadcrumb", {
  enumerable: true,
  get: function () { return core.addBreadcrumb; }
});
Object.defineProperty(exports, "captureException", {
  enumerable: true,
  get: function () { return core.captureException; }
});
Object.defineProperty(exports, "captureMessage", {
  enumerable: true,
  get: function () { return core.captureMessage; }
});
Object.defineProperty(exports, "setExtra", {
  enumerable: true,
  get: function () { return core.setExtra; }
});
Object.defineProperty(exports, "setTag", {
  enumerable: true,
  get: function () { return core.setTag; }
});
Object.defineProperty(exports, "setUser", {
  enumerable: true,
  get: function () { return core.setUser; }
});
exports.BugwatchErrorBoundary = BugwatchErrorBoundary;
exports.BugwatchProvider = BugwatchProvider;
exports.closeClient = closeClient;
exports.initClient = initClient;
//# sourceMappingURL=client.js.map
//# sourceMappingURL=client.js.map