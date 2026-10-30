import {
  addBreadcrumb,
  captureMessage,
  getClient,
  setExtra,
  setTag,
  setUser,
  type Breadcrumb,
  type BugwatchClient,
  type ErrorEvent,
  type UserContext,
} from "@bugwatch/core";
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import { captureException } from "./errors";
import { init } from "./init";
import type { ReactNativeOptions } from "./types";

export type BugwatchFallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

export interface BugwatchErrorBoundaryProps {
  children?: ReactNode;
  /** Rendered instead of the children after an error. May be a function receiving the error and a reset callback. */
  fallback?: BugwatchFallback;
  /** Called after the error has been reported. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Catches render errors in its subtree, reports them, and renders a fallback. */
export class BugwatchErrorBoundary extends Component<BugwatchErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureException(error, {
      tags: { mechanism: "react.errorBoundary" },
      extra: { componentStack: errorInfo.componentStack },
    });
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback(error, this.reset);
    if (fallback !== undefined) return fallback;

    return (
      <View accessibilityRole="alert" style={{ padding: 20, flex: 1, justifyContent: "center", backgroundColor: "#ffffff" }}>
        <Text style={{ fontSize: 18, fontWeight: "bold", color: "#212529" }}>Something went wrong</Text>
        <Text style={{ marginVertical: 12, color: "#495057" }}>{error.message}</Text>
        <Pressable accessibilityRole="button" onPress={this.reset}>
          <Text style={{ color: "#1c7ed6" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

/** Wrap a component in a {@link BugwatchErrorBoundary}. */
export function withBugwatchErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  options?: Pick<BugwatchErrorBoundaryProps, "fallback" | "onError">
): ComponentType<P> {
  const WithErrorBoundary = (props: P): ReactElement => (
    <BugwatchErrorBoundary fallback={options?.fallback} onError={options?.onError}>
      <WrappedComponent {...props} />
    </BugwatchErrorBoundary>
  );
  WithErrorBoundary.displayName = `withBugwatchErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;
  return WithErrorBoundary;
}

export interface BugwatchContextValue {
  client: BugwatchClient | null;
  captureException: (error: unknown, context?: Partial<ErrorEvent>) => string;
  captureMessage: (message: string, level?: ErrorEvent["level"]) => string;
  addBreadcrumb: (breadcrumb: Omit<Breadcrumb, "timestamp">) => void;
  setUser: (user: UserContext | null) => void;
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
}

const defaultContextValue: BugwatchContextValue = {
  client: null,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
};

const BugwatchContext = createContext<BugwatchContextValue>(defaultContextValue);

/** Access the Bugwatch API from components. Works with or without a provider. */
export function useBugwatch(): BugwatchContextValue {
  return useContext(BugwatchContext);
}

export interface BugwatchProviderProps extends BugwatchErrorBoundaryProps {
  /** Options for {@link init}. Omit when `init()` was already called at app startup. */
  options?: ReactNativeOptions;
}

/**
 * Initializes Bugwatch (once) and wraps the tree in an error boundary.
 * Prefer calling `init()` at module scope so errors thrown before the first
 * render are captured as well.
 */
export function BugwatchProvider({ options, children, fallback, onError }: BugwatchProviderProps): ReactElement {
  const [client, setClient] = useState<BugwatchClient | null>(() => getClient());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const hasOptions = options !== undefined;

  useEffect(() => {
    const current = optionsRef.current;
    if (!current) return;
    try {
      setClient(init(current));
    } catch (err) {
      if (current.debug) console.error("[Bugwatch] Initialization failed:", err);
    }
  }, [hasOptions]);

  const value = useMemo<BugwatchContextValue>(() => ({ ...defaultContextValue, client }), [client]);

  return (
    <BugwatchContext.Provider value={value}>
      <BugwatchErrorBoundary fallback={fallback} onError={onError}>
        {children}
      </BugwatchErrorBoundary>
    </BugwatchContext.Provider>
  );
}
