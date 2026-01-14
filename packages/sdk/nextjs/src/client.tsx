"use client";

import { Component, useEffect, type ReactNode, type ErrorInfo } from "react";
import {
  init as coreInit,
  captureException,
  addBreadcrumb,
  getClient,
  type BugwatchOptions,
} from "@bugwatch/core";

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

  // Initialize core SDK
  coreInit(mergedOptions);

  // Add browser info
  const client = getClient();
  if (client) {
    client.setTag("runtime", "browser");
    client.setTag("browser.userAgent", navigator.userAgent);
  }

  // Set up global error handler
  if (mergedOptions.captureGlobalErrors) {
    setupGlobalErrorHandler();
  }

  // Set up unhandled rejection handler
  if (mergedOptions.captureUnhandledRejections) {
    setupUnhandledRejectionHandler();
  }

  // Set up console breadcrumbs
  if (mergedOptions.captureConsoleBreadcrumbs) {
    setupConsoleBreadcrumbs();
  }

  // Set up click breadcrumbs
  if (mergedOptions.captureClickBreadcrumbs) {
    setupClickBreadcrumbs();
  }

  // Set up navigation breadcrumbs
  if (mergedOptions.captureNavigationBreadcrumbs) {
    setupNavigationBreadcrumbs();
  }

  isClientInitialized = true;

  if (mergedOptions.debug) {
    console.log("[Bugwatch] Client SDK initialized");
  }
}

/**
 * Set up window.onerror handler
 */
function setupGlobalErrorHandler(): void {
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
}

/**
 * Set up unhandled rejection handler
 */
function setupUnhandledRejectionHandler(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

    captureException(error, {
      tags: { mechanism: "onunhandledrejection" },
    });
  });
}

/**
 * Set up console breadcrumbs
 */
function setupConsoleBreadcrumbs(): void {
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
}

/**
 * Set up click breadcrumbs
 */
function setupClickBreadcrumbs(): void {
  document.addEventListener(
    "click",
    (event) => {
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
    },
    { capture: true }
  );
}

/**
 * Set up navigation breadcrumbs
 */
function setupNavigationBreadcrumbs(): void {
  // Track initial page load
  addBreadcrumb({
    category: "navigation",
    message: window.location.href,
    level: "info",
    data: { from: document.referrer || undefined },
  });

  // Track history changes
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
  window.addEventListener("popstate", () => {
    addBreadcrumb({
      category: "navigation",
      message: window.location.href,
      level: "info",
    });
  });
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
 * Provider component that initializes Bugwatch on the client
 */
interface BugwatchProviderProps {
  options: ClientOptions;
  children: ReactNode;
}

export function BugwatchProvider({
  options,
  children,
}: BugwatchProviderProps): JSX.Element {
  useEffect(() => {
    initClient(options);
  }, [options]);

  return <BugwatchErrorBoundary>{children}</BugwatchErrorBoundary>;
}

// Re-export useful functions
export { captureException, captureMessage, addBreadcrumb, setUser, setTag, setExtra } from "@bugwatch/core";
