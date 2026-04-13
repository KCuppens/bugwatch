import { Component, useMemo, useEffect } from 'react';
import { init, getClient, isBrowserExtensionError, captureException, addBreadcrumb } from '@bugwatch/core';
export { addBreadcrumb, captureException, captureMessage, setExtra, setTag, setUser } from '@bugwatch/core';
import { jsxs, jsx } from 'react/jsx-runtime';

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
    init(mergedOptions);
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
    if (error && !error.__bugwatch_captured && !isBrowserExtensionError(error)) {
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
    if (isBrowserExtensionError(error)) {
      return;
    }
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
  let inBreadcrumb = false;
  const wrap = (method, level) => {
    console[method] = (...args) => {
      if (!inBreadcrumb) {
        inBreadcrumb = true;
        try {
          addBreadcrumb({
            category: "console",
            message: args.map(String).join(" "),
            level
          });
        } catch {
        } finally {
          inBreadcrumb = false;
        }
      }
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
  window.fetch = async function(input, init) {
    let url;
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url || String(input);
    } catch {
      return originalFetch.call(window, input, init);
    }
    const method = init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET";
    if (url.startsWith(sdkEventUrl)) {
      return originalFetch.call(window, input, init);
    }
    const startTime = Date.now();
    try {
      const response = await originalFetch.call(window, input, init);
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
        let responseBody = "";
        try {
          responseBody = await response.clone().text();
          if (responseBody.length > 2e3) {
            responseBody = responseBody.substring(0, 2e3) + "...(truncated)";
          }
        } catch {
        }
        let requestBody = "";
        if (init?.body) {
          try {
            requestBody = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
            if (requestBody.length > 2e3) {
              requestBody = requestBody.substring(0, 2e3) + "...(truncated)";
            }
          } catch {
          }
        }
        const error = new Error(`HTTP ${response.status}: ${method.toUpperCase()} ${url}`);
        error.name = "HttpError";
        captureException(error, {
          level: response.status >= 500 ? "error" : "warning",
          tags: {
            mechanism: "fetch",
            "http.method": method.toUpperCase(),
            "http.status_code": String(response.status),
            "http.url": url
          },
          request: {
            url,
            method: method.toUpperCase()
          },
          extra: {
            request_body: requestBody || void 0,
            response_body: responseBody || "(empty response)",
            response_status: response.status,
            duration_ms: duration
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
var BugwatchErrorBoundary = class extends Component {
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
function BugwatchProvider({
  options,
  children
}) {
  const optionsKey = useMemo(
    () => options ? JSON.stringify(options) : "",
    [options]
  );
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
    return () => {
      closeClient();
    };
  }, [optionsKey]);
  return /* @__PURE__ */ jsx(BugwatchErrorBoundary, { children });
}

export { BugwatchErrorBoundary, BugwatchProvider, closeClient, initClient };
//# sourceMappingURL=client.mjs.map
//# sourceMappingURL=client.mjs.map