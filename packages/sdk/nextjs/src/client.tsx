"use client";

import { Component, useEffect, type ReactNode, type ErrorInfo } from "react";
import {
  init as coreInit,
  captureException,
  addBreadcrumb,
  getClient,
  type BugwatchOptions,
} from "@bugwatch/core";
import { getEnvConfig } from "./config";

/**
 * Client-side Bugwatch options
 */
export interface ClientOptions extends BugwatchOptions {
  /** Capture unhandled errors in window.onerror */
  captureGlobalErrors?: boolean;
  /** Capture unhandled promise rejections */
  captureUnhandledRejections?: boolean;
  /** Capture console errors as breadcrumbs */
  captureConsoleBreadcrumbs?: boolean;
  /** Capture click events as breadcrumbs */
  captureClickBreadcrumbs?: boolean;
  /** Capture navigation as breadcrumbs */
  captureNavigationBreadcrumbs?: boolean;
  /** Capture failed HTTP requests (4xx/5xx) as errors and all requests as breadcrumbs */
  captureHttpErrors?: boolean;
}

const DEFAULT_CLIENT_OPTIONS: Partial<ClientOptions> = {
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  captureConsoleBreadcrumbs: true,
  captureClickBreadcrumbs: true,
  captureNavigationBreadcrumbs: true,
  captureHttpErrors: true,
};

let isClientInitialized = false;

// Store cleanup functions for teardown
let clientCleanupFunctions: (() => void)[] = [];

/**
 * Initialize Bugwatch on the client side
 */
export function initClient(options: ClientOptions): void {
  if (typeof window === "undefined") {
    return; // Only run on client
  }

  if (isClientInitialized) {
    return;
  }

  const mergedOptions = { ...DEFAULT_CLIENT_OPTIONS, ...options };

  // Initialize core SDK with error handling
  try {
    coreInit(mergedOptions);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[Bugwatch] Client initialization failed:', err);
    }
    return;
  }

  // Add browser info
  const client = getClient();
  if (client) {
    client.setTag("runtime", "browser");
    client.setTag("browser.userAgent", navigator.userAgent);
  }

  // Set up global error handler
  if (mergedOptions.captureGlobalErrors) {
    const cleanup = setupGlobalErrorHandler();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  // Set up unhandled rejection handler
  if (mergedOptions.captureUnhandledRejections) {
    const cleanup = setupUnhandledRejectionHandler();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  // Set up console breadcrumbs
  if (mergedOptions.captureConsoleBreadcrumbs) {
    const cleanup = setupConsoleBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  // Set up click breadcrumbs
  if (mergedOptions.captureClickBreadcrumbs) {
    const cleanup = setupClickBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  // Set up navigation breadcrumbs
  if (mergedOptions.captureNavigationBreadcrumbs) {
    const cleanup = setupNavigationBreadcrumbs();
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  // Set up fetch instrumentation (HTTP breadcrumbs + error capture)
  if (mergedOptions.captureHttpErrors) {
    const cleanup = setupFetchInstrumentation(mergedOptions);
    if (cleanup) clientCleanupFunctions.push(cleanup);
  }

  isClientInitialized = true;

  if (mergedOptions.debug) {
    console.log("[Bugwatch] Client SDK initialized");
  }
}

/**
 * Close the client SDK and clean up all resources.
 * This restores original handlers and removes event listeners.
 */
export function closeClient(): void {
  for (const cleanup of clientCleanupFunctions) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }
  clientCleanupFunctions = [];
  isClientInitialized = false;
}

/**
 * Set up window.onerror handler
 * Returns cleanup function to restore original handler
 */
function setupGlobalErrorHandler(): () => void {
  const originalOnError = window.onerror;

  window.onerror = (message, source, lineno, colno, error) => {
    if (error && !(error as any).__bugwatch_captured) {
      captureException(error, {
        tags: { mechanism: "onerror" },
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

/**
 * Set up unhandled rejection handler
 * Returns cleanup function to remove listener
 */
function setupUnhandledRejectionHandler(): () => void {
  const handler = (event: PromiseRejectionEvent) => {
    // Skip if already captured by fetch instrumentation
    if (event.reason && (event.reason as any).__bugwatch_captured) {
      return;
    }

    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

    captureException(error, {
      tags: { mechanism: "onunhandledrejection" },
    });
  };

  window.addEventListener("unhandledrejection", handler);

  return () => {
    window.removeEventListener("unhandledrejection", handler);
  };
}

/**
 * Set up console breadcrumbs
 * Returns cleanup function to restore original console methods
 */
function setupConsoleBreadcrumbs(): () => void {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const wrap = (
    method: keyof typeof originalConsole,
    level: "debug" | "info" | "warning" | "error"
  ) => {
    console[method] = (...args: unknown[]) => {
      addBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level,
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

/**
 * Set up click breadcrumbs
 * Returns cleanup function to remove listener
 */
function setupClickBreadcrumbs(): () => void {
  const handler = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target) return;

    const tagName = target.tagName?.toLowerCase();
    const id = target.id ? `#${target.id}` : "";
    const className = target.className
      ? `.${String(target.className).split(" ").join(".")}`
      : "";
    const text = target.textContent?.slice(0, 50) || "";

    addBreadcrumb({
      category: "ui.click",
      message: `${tagName}${id}${className}${text ? ` "${text}"` : ""}`,
      level: "info",
    });
  };

  document.addEventListener("click", handler, { capture: true });

  return () => {
    document.removeEventListener("click", handler, { capture: true });
  };
}

/**
 * Set up navigation breadcrumbs
 * Returns cleanup function to restore original history methods
 */
function setupNavigationBreadcrumbs(): () => void {
  // Track initial page load
  addBreadcrumb({
    category: "navigation",
    message: window.location.href,
    level: "info",
    data: { from: document.referrer || undefined },
  });

  // Store original methods for restoration
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info",
    });
    return result;
  };

  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info",
    });
    return result;
  };

  // Track popstate (back/forward)
  const popstateHandler = () => {
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info",
    });
  };

  window.addEventListener("popstate", popstateHandler);

  // Return cleanup function
  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", popstateHandler);
  };
}

/**
 * Set up fetch instrumentation to automatically:
 * - Add HTTP breadcrumbs for all fetch requests
 * - Capture failed responses (4xx/5xx) as exceptions
 * - Capture network errors as exceptions
 * Returns cleanup function to restore original fetch
 */
function setupFetchInstrumentation(options: ClientOptions): () => void {
  const originalFetch = window.fetch;
  const sdkEndpoint = options.endpoint || "https://api.bugwatch.dev";

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const method = init?.method || "GET";

    // Skip instrumenting our own SDK requests to avoid infinite loops
    if (url.startsWith(sdkEndpoint)) {
      return originalFetch.call(window, input, init);
    }

    const startTime = Date.now();

    try {
      const response = await originalFetch.call(window, input, init);
      const duration = Date.now() - startTime;

      // Add breadcrumb for every request
      addBreadcrumb({
        category: "http",
        message: `${method.toUpperCase()} ${url}`,
        level: response.ok ? "info" : "warning",
        data: {
          method: method.toUpperCase(),
          url,
          status_code: response.status,
          duration_ms: duration,
        },
      });

      // Capture 4xx/5xx responses as errors (exclude 401/403 — expected auth flow)
      if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
        const error = new Error(`HTTP ${response.status}: ${method.toUpperCase()} ${url}`);
        error.name = "HttpError";
        captureException(error, {
          level: response.status >= 500 ? "error" : "warning",
          tags: {
            mechanism: "fetch",
            "http.method": method.toUpperCase(),
            "http.status_code": String(response.status),
            "http.url": url,
          },
        });
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Network error (DNS failure, CORS, connection refused, etc.)
      addBreadcrumb({
        category: "http",
        message: `${method.toUpperCase()} ${url} (network error)`,
        level: "error",
        data: {
          method: method.toUpperCase(),
          url,
          duration_ms: duration,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      const networkError = error instanceof Error
        ? error
        : new Error(String(error));
      networkError.name = networkError.name || "NetworkError";

      captureException(networkError, {
        level: "error",
        tags: {
          mechanism: "fetch",
          "http.method": method.toUpperCase(),
          "http.url": url,
        },
      });

      // Mark as already captured so unhandledrejection handler skips it
      if (error instanceof Error) {
        (error as any).__bugwatch_captured = true;
      }

      throw error; // Re-throw so the caller still gets the error
    }
  };

  return () => {
    window.fetch = originalFetch;
  };
}

/**
 * Props for BugwatchErrorBoundary
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that captures errors to Bugwatch
 */
export class BugwatchErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Capture to Bugwatch
    captureException(error, {
      tags: { mechanism: "react.errorBoundary" },
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Call custom error handler
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;

      if (typeof fallback === "function") {
        return fallback(this.state.error);
      }

      if (fallback) {
        return fallback;
      }

      return (
        <div style={{ padding: 20 }}>
          <h2>Something went wrong</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Provider component that initializes Bugwatch on the client.
 *
 * Options are optional - if not provided, reads from environment variables:
 * - `NEXT_PUBLIC_BUGWATCH_API_KEY` - API key
 * - `NEXT_PUBLIC_BUGWATCH_ENVIRONMENT` - Environment tag
 * - `NEXT_PUBLIC_BUGWATCH_RELEASE` - Release version
 * - `NEXT_PUBLIC_BUGWATCH_DEBUG` - Enable debug mode ('true')
 *
 * @example
 * ```tsx
 * // With NEXT_PUBLIC_BUGWATCH_API_KEY env var set
 * <BugwatchProvider>
 *   <App />
 * </BugwatchProvider>
 *
 * // With explicit options
 * <BugwatchProvider options={{ apiKey: "bw_live_xxxxx" }}>
 *   <App />
 * </BugwatchProvider>
 * ```
 */
interface BugwatchProviderProps {
  options?: ClientOptions;
  children: ReactNode;
}

export function BugwatchProvider({
  options,
  children,
}: BugwatchProviderProps): JSX.Element {
  useEffect(() => {
    // Merge env config with explicit options (explicit takes precedence)
    const envConfig = getEnvConfig();
    const mergedOptions = { ...DEFAULT_CLIENT_OPTIONS, ...envConfig, ...options } as ClientOptions;

    // Skip initialization if no API key is available
    if (!mergedOptions.apiKey) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Bugwatch] No API key provided. Set NEXT_PUBLIC_BUGWATCH_API_KEY env var or pass options.apiKey');
      }
      return;
    }

    initClient(mergedOptions);
  }, [options]);

  return <BugwatchErrorBoundary>{children}</BugwatchErrorBoundary>;
}

// Re-export useful functions
export { captureException, captureMessage, addBreadcrumb, setUser, setTag, setExtra } from "@bugwatch/core";
