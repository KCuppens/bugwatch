import { Component, ReactNode, ErrorInfo } from 'react';
import { BugwatchOptions } from '@bugwatch/core';
export { addBreadcrumb, captureException, captureMessage, setExtra, setTag, setUser } from '@bugwatch/core';

/**
 * Client-side Bugwatch options
 */
interface ClientOptions extends BugwatchOptions {
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
/**
 * Initialize Bugwatch on the client side
 */
declare function initClient(options: ClientOptions): void;
/**
 * Close the client SDK and clean up all resources.
 * This restores original handlers and removes event listeners.
 */
declare function closeClient(): void;
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
declare class BugwatchErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps);
    static getDerivedStateFromError(error: Error): ErrorBoundaryState;
    componentDidCatch(error: Error, errorInfo: ErrorInfo): void;
    render(): ReactNode;
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
declare function BugwatchProvider({ options, children, }: BugwatchProviderProps): JSX.Element;

export { BugwatchErrorBoundary, BugwatchProvider, type ClientOptions, closeClient, initClient };
