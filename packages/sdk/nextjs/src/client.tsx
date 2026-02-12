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
}

const DEFAULT_CLIENT_OPTIONS: Partial<ClientOptions> = {
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  captureConsoleBreadcrumbs: true,
  captureClickBreadcrumbs: true,
  captureNavigationBreadcrumbs: true,
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
    if (error) {
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
