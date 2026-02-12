import React, {
  Component,
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type ErrorInfo,
} from "react";
import {
  init as coreInit,
  getClient,
  getEnvConfig,
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
}

const DEFAULT_REACT_OPTIONS: Partial<ReactOptions> = {
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  captureConsoleBreadcrumbs: true,
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
  useEffect(() => {
    // Merge env config with explicit options (explicit takes precedence)
    const envConfig = getEnvConfig();
    const mergedOptions = { ...DEFAULT_REACT_OPTIONS, ...envConfig, ...options };

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

    // Set up global error handlers
    if (typeof window !== "undefined") {
      if (mergedOptions.captureGlobalErrors) {
        originalOnError = window.onerror;
        window.onerror = (message, source, lineno, colno, error) => {
          if (error) {
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
          const error =
            event.reason instanceof Error
              ? event.reason
              : new Error(String(event.reason));
          coreCaptureException(error, {
            tags: { mechanism: "unhandledrejection" },
          });
        };
        window.addEventListener("unhandledrejection", unhandledRejectionHandler);
      }

      if (mergedOptions.captureConsoleBreadcrumbs) {
        originalConsoleError = console.error;
        console.error = (...args: unknown[]) => {
          coreAddBreadcrumb({
            category: "console",
            message: args.map(String).join(" "),
            level: "error",
          });
          originalConsoleError!(...args);
        };
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
      }
    };
  }, [options]);

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
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

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
