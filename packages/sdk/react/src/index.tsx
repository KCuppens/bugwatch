"use client";

import React, {
  Component,
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type ErrorInfo,
} from "react";
import {
  init as coreInit,
  getClient,
  getEnvConfig,
  isBrowserExtensionError,
  captureException as coreCaptureException,
  captureMessage as coreCaptureMessage,
  addBreadcrumb as coreAddBreadcrumb,
  setUser as coreSetUser,
  setTag as coreSetTag,
  setExtra as coreSetExtra,
  type BugwatchOptions,
  type BugwatchClient,
  type UserContext,
  type Breadcrumb,
  type ErrorEvent,
} from "@bugwatch/core";

// Re-export types
export type { BugwatchOptions, UserContext, ErrorEvent, Breadcrumb } from "@bugwatch/core";

/**
 * React-specific SDK options
 */
export interface ReactOptions extends BugwatchOptions {
  /** Capture window.onerror events */
  captureGlobalErrors?: boolean;
  /** Capture unhandled promise rejections */
  captureUnhandledRejections?: boolean;
  /** Capture console.error as breadcrumbs */
  captureConsoleBreadcrumbs?: boolean;
  /** Capture HTTP 4xx/5xx errors from fetch requests */
  captureHttpErrors?: boolean;
}

const DEFAULT_REACT_OPTIONS: Partial<ReactOptions> = {
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  captureConsoleBreadcrumbs: true,
  captureHttpErrors: true,
};

/**
 * Bugwatch context
 */
interface BugwatchContextValue {
  client: BugwatchClient | null;
  captureException: (error: Error, context?: Partial<ErrorEvent>) => string;
  captureMessage: (message: string, level?: ErrorEvent["level"]) => string;
  addBreadcrumb: (breadcrumb: Omit<Breadcrumb, "timestamp">) => void;
  setUser: (user: UserContext | null) => void;
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
}

const BugwatchContext = createContext<BugwatchContextValue | null>(null);

/**
 * Hook to access Bugwatch SDK
 */
export function useBugwatch(): BugwatchContextValue {
  const context = useContext(BugwatchContext);
  if (!context) {
    throw new Error("useBugwatch must be used within a BugwatchProvider");
  }
  return context;
}

/**
 * Hook to capture exceptions
 */
export function useCaptureException(): (
  error: Error,
  context?: Partial<ErrorEvent>
) => string {
  const { captureException } = useBugwatch();
  return captureException;
}

/**
 * Hook to capture messages
 */
export function useCaptureMessage(): (
  message: string,
  level?: ErrorEvent["level"]
) => string {
  const { captureMessage } = useBugwatch();
  return captureMessage;
}

/**
 * Set up fetch instrumentation to automatically:
 * - Add HTTP breadcrumbs for all fetch requests
 * - Capture failed responses (4xx/5xx) as exceptions
 * - Capture network errors as exceptions
 * Returns cleanup function to restore original fetch
 */
function setupFetchInstrumentation(options: { endpoint?: string }): () => void {
  const originalFetch = window.fetch;
  const sdkEndpoint = options.endpoint || "https://api.bugwatch.dev";
  const sdkEventUrl = `${sdkEndpoint}/api/v1/events`;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: string;
    try {
      url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url || String(input);
    } catch {
      return originalFetch.call(window, input, init);
    }
    const method = init?.method || (typeof input !== "string" && !(input instanceof URL) ? (input as Request).method : "GET") || "GET";

    // Skip instrumenting our own SDK event requests to avoid infinite loops
    if (url.startsWith(sdkEventUrl)) {
      return originalFetch.call(window, input, init);
    }

    const startTime = Date.now();

    try {
      const response = await originalFetch.call(window, input, init);
      const duration = Date.now() - startTime;

      // Add breadcrumb for every request
      coreAddBreadcrumb({
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
        // Clone response to read body without consuming the original
        let responseBody = '';
        try {
          responseBody = await response.clone().text();
          if (responseBody.length > 2000) {
            responseBody = responseBody.substring(0, 2000) + '...(truncated)';
          }
        } catch {
          // Ignore body read errors
        }

        // Capture request body if present
        let requestBody = '';
        if (init?.body) {
          try {
            requestBody = typeof init.body === 'string'
              ? init.body
              : JSON.stringify(init.body);
            if (requestBody.length > 2000) {
              requestBody = requestBody.substring(0, 2000) + '...(truncated)';
            }
          } catch {
            // Ignore serialization errors
          }
        }

        const error = new Error(`HTTP ${response.status}: ${method.toUpperCase()} ${url}`);
        error.name = "HttpError";
        coreCaptureException(error, {
          level: response.status >= 500 ? "error" : "warning",
          tags: {
            mechanism: "fetch",
            "http.method": method.toUpperCase(),
            "http.status_code": String(response.status),
            "http.url": url,
          },
          request: {
            url,
            method: method.toUpperCase(),
          },
          extra: {
            request_body: requestBody || undefined,
            response_body: responseBody || "(empty response)",
            response_status: response.status,
            duration_ms: duration,
          },
        });
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Network error (DNS failure, CORS, connection refused, etc.)
      coreAddBreadcrumb({
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

      coreCaptureException(networkError, {
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
 * Props for BugwatchProvider
 */
interface BugwatchProviderProps {
  /**
   * SDK configuration options.
   * Optional - if not provided, reads from environment variables:
   * - `BUGWATCH_API_KEY` - API key (required unless passed explicitly)
   * - `BUGWATCH_ENVIRONMENT` - Environment tag
   * - `BUGWATCH_RELEASE` - Release version
   * - `BUGWATCH_DEBUG` - Enable debug mode ('true')
   */
  options?: ReactOptions;
  /** Child components */
  children: ReactNode;
  /** Optional fallback UI for error boundary */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Called when an error is caught by the error boundary */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/**
 * Bugwatch Provider component
 * Initializes the SDK and provides context to child components
 *
 * @example
 * ```tsx
 * // With BUGWATCH_API_KEY env var set
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
export function BugwatchProvider({
  options,
  children,
  fallback,
  onError,
}: BugwatchProviderProps): JSX.Element {
  // Serialize options to a stable string so useEffect doesn't re-run on every render.
  // Object identity of `options` changes every render if passed inline.
  const optionsKey = useMemo(
    () => (options ? JSON.stringify(options) : ""),
    [options]
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const currentOptions = optionsRef.current;

    // Merge env config with explicit options (explicit takes precedence)
    const envConfig = getEnvConfig();
    const mergedOptions = { ...DEFAULT_REACT_OPTIONS, ...envConfig, ...currentOptions };

    // Skip initialization if no API key is available
    if (!mergedOptions.apiKey) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Bugwatch] No API key provided. Set BUGWATCH_API_KEY env var or pass options.apiKey');
      }
      return;
    }

    // Wrap initialization in try-catch for graceful degradation
    try {
      coreInit(mergedOptions);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Bugwatch] Initialization failed:', err);
      }
      return;
    }

    // Add React-specific tags
    const client = getClient();
    if (client) {
      client.setTag("framework", "react");
    }

    // Store original handlers for cleanup
    let originalOnError: typeof window.onerror | null = null;
    let originalConsoleError: typeof console.error | null = null;
    let unhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;
    let cleanupFetchInstrumentation: (() => void) | null = null;

    // Set up global error handlers
    if (typeof window !== "undefined") {
      if (mergedOptions.captureGlobalErrors) {
        originalOnError = window.onerror;
        window.onerror = (message, source, lineno, colno, error) => {
          if (error && !(error as any).__bugwatch_captured && !isBrowserExtensionError(error)) {
            coreCaptureException(error, {
              tags: { mechanism: "window.onerror" },
            });
          }
          if (originalOnError) {
            return originalOnError(message, source, lineno, colno, error);
          }
          return false;
        };
      }

      if (mergedOptions.captureUnhandledRejections) {
        unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
          // Skip if already captured by fetch instrumentation
          if (event.reason && (event.reason as any).__bugwatch_captured) {
            return;
          }
          const error =
            event.reason instanceof Error
              ? event.reason
              : new Error(String(event.reason));
          // Skip errors originating from browser extensions
          if (isBrowserExtensionError(error)) {
            return;
          }
          coreCaptureException(error, {
            tags: { mechanism: "unhandledrejection" },
          });
        };
        window.addEventListener("unhandledrejection", unhandledRejectionHandler);
      }

      if (mergedOptions.captureConsoleBreadcrumbs) {
        originalConsoleError = console.error;
        let inBreadcrumb = false;
        console.error = (...args: unknown[]) => {
          if (!inBreadcrumb) {
            inBreadcrumb = true;
            try {
              coreAddBreadcrumb({
                category: "console",
                message: args.map(String).join(" "),
                level: "error",
              });
            } catch {
              // Silently ignore breadcrumb failures
            } finally {
              inBreadcrumb = false;
            }
          }
          originalConsoleError!(...args);
        };
      }

      if (mergedOptions.captureHttpErrors) {
        cleanupFetchInstrumentation = setupFetchInstrumentation(mergedOptions);
      }
    }

    if (mergedOptions.debug) {
      console.log("[Bugwatch] React SDK initialized");
    }

    // Cleanup function to prevent memory leaks
    return () => {
      if (typeof window !== "undefined") {
        // Restore original window.onerror
        if (originalOnError !== null && mergedOptions.captureGlobalErrors) {
          window.onerror = originalOnError;
        }

        // Remove unhandled rejection listener
        if (unhandledRejectionHandler && mergedOptions.captureUnhandledRejections) {
          window.removeEventListener("unhandledrejection", unhandledRejectionHandler);
        }

        // Restore original console.error
        if (originalConsoleError !== null && mergedOptions.captureConsoleBreadcrumbs) {
          console.error = originalConsoleError;
        }

        // Restore original fetch
        if (cleanupFetchInstrumentation) {
          cleanupFetchInstrumentation();
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  const captureException = useCallback(
    (error: Error, context?: Partial<ErrorEvent>) => {
      return coreCaptureException(error, context);
    },
    []
  );

  const captureMessage = useCallback(
    (message: string, level?: ErrorEvent["level"]) => {
      return coreCaptureMessage(message, level);
    },
    []
  );

  const addBreadcrumb = useCallback(
    (breadcrumb: Omit<Breadcrumb, "timestamp">) => {
      coreAddBreadcrumb(breadcrumb);
    },
    []
  );

  const setUser = useCallback((user: UserContext | null) => {
    coreSetUser(user);
  }, []);

  const setTag = useCallback((key: string, value: string) => {
    coreSetTag(key, value);
  }, []);

  const setExtra = useCallback((key: string, value: unknown) => {
    coreSetExtra(key, value);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<BugwatchContextValue>(
    () => ({
      client: getClient(),
      captureException,
      captureMessage,
      addBreadcrumb,
      setUser,
      setTag,
      setExtra,
    }),
    [captureException, captureMessage, addBreadcrumb, setUser, setTag, setExtra]
  );

  return (
    <BugwatchContext.Provider value={contextValue}>
      <ErrorBoundary fallback={fallback} onError={onError}>
        {children}
      </ErrorBoundary>
    </BugwatchContext.Provider>
  );
}

/**
 * Error Boundary Props
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /**
   * Auto-reset the error state when the URL changes (default: true).
   * Listens for `popstate` and patches `pushState`/`replaceState` to detect
   * client-side navigation. Disable if you want errors to persist across nav.
   */
  resetOnLocationChange?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const LOCATION_CHANGE_EVENT = "bugwatch:location-change";
let historyPatched = false;

function patchHistoryOnce(): void {
  if (historyPatched || typeof window === "undefined" || !window.history) return;
  historyPatched = true;
  const fire = () => window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (...args) {
    const r = origPush(...args);
    fire();
    return r;
  };
  window.history.replaceState = function (...args) {
    const r = origReplace(...args);
    fire();
    return r;
  };
  window.addEventListener("popstate", fire);
}

/**
 * Error Boundary component
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private locationListenerAttached = false;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidMount(): void {
    if (this.props.resetOnLocationChange !== false && typeof window !== "undefined") {
      patchHistoryOnce();
      window.addEventListener(LOCATION_CHANGE_EVENT, this.handleLocationChange);
      this.locationListenerAttached = true;
    }
  }

  componentWillUnmount(): void {
    if (this.locationListenerAttached && typeof window !== "undefined") {
      window.removeEventListener(LOCATION_CHANGE_EVENT, this.handleLocationChange);
    }
  }

  handleLocationChange = (): void => {
    if (this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  };

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Capture to Bugwatch
    coreCaptureException(error, {
      tags: { mechanism: "react.errorBoundary" },
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Call custom handler
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;

      if (typeof fallback === "function") {
        return fallback(this.state.error, this.reset);
      }

      if (fallback) {
        return fallback;
      }

      return (
        <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error.message}</p>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Standalone Error Boundary for custom use
 */
export { ErrorBoundary as BugwatchErrorBoundary };

/**
 * Higher-order component for error boundary
 */
export function withBugwatchErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    fallback?: ErrorBoundaryProps["fallback"];
    onError?: ErrorBoundaryProps["onError"];
  }
): React.ComponentType<P> {
  const WithErrorBoundary = (props: P) => (
    <ErrorBoundary fallback={options?.fallback} onError={options?.onError}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withBugwatchErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return WithErrorBoundary;
}

// Re-export core functions for convenience
export {
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  getClient,
  init,
} from "@bugwatch/core";
