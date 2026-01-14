"use client";

/**
 * Pre-built error boundary components for Next.js App Router
 *
 * Usage:
 *
 * // app/error.tsx
 * export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
 *
 * // app/global-error.tsx
 * export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
 */

import { useEffect, type ReactNode } from "react";
import { captureException } from "@bugwatch/core";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Default styles for error pages
 */
const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "50vh",
    padding: "2rem",
    textAlign: "center" as const,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  heading: {
    marginBottom: "1rem",
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "#1a1a1a",
  },
  message: {
    marginBottom: "1.5rem",
    color: "#666",
    fontSize: "1rem",
    maxWidth: "400px",
  },
  button: {
    padding: "0.75rem 1.5rem",
    fontSize: "1rem",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "0.5rem",
    transition: "background-color 0.2s ease",
  },
  buttonHover: {
    backgroundColor: "#0051a8",
  },
};

/**
 * Pre-built App Router error.tsx component
 *
 * Automatically captures errors to Bugwatch and displays
 * a user-friendly error message with retry option.
 *
 * @example
 * // app/error.tsx
 * export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
 */
export function BugwatchError({ error, reset }: ErrorPageProps): ReactNode {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "app-router-error-boundary" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Something went wrong</h2>
      <p style={styles.message}>
        We've been notified and are looking into it. Please try again.
      </p>
      <button
        onClick={reset}
        style={styles.button}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor =
            styles.buttonHover.backgroundColor;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = styles.button.backgroundColor;
        }}
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Pre-built App Router global-error.tsx component
 *
 * Handles root layout errors. Must include html and body tags.
 *
 * @example
 * // app/global-error.tsx
 * export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
 */
export function BugwatchGlobalError({ error, reset }: ErrorPageProps): ReactNode {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "global-error-boundary" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            ...styles.container,
            minHeight: "100vh",
          }}
        >
          <h1 style={styles.heading}>Application Error</h1>
          <p style={styles.message}>
            Something went wrong. We've been notified and are working on it.
          </p>
          <button
            onClick={reset}
            style={styles.button}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                styles.buttonHover.backgroundColor;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                styles.button.backgroundColor;
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

interface CustomErrorPageProps extends ErrorPageProps {
  /** Custom title */
  title?: string;
  /** Custom message */
  message?: string;
  /** Custom retry button text */
  retryText?: string;
  /** Custom styles for the container */
  containerStyle?: React.CSSProperties;
  /** Custom styles for the button */
  buttonStyle?: React.CSSProperties;
  /** Additional tags for error tracking */
  tags?: Record<string, string>;
  /** Hide the retry button */
  hideRetryButton?: boolean;
  /** Custom content to render */
  children?: ReactNode;
}

/**
 * Customizable error component for more control
 *
 * @example
 * // app/error.tsx
 * import { CustomBugwatchError } from '@bugwatch/nextjs/error-components';
 *
 * export default function Error({ error, reset }) {
 *   return (
 *     <CustomBugwatchError
 *       error={error}
 *       reset={reset}
 *       title="Oops!"
 *       message="Something unexpected happened."
 *     />
 *   );
 * }
 */
export function CustomBugwatchError({
  error,
  reset,
  title = "Something went wrong",
  message = "We've been notified and are looking into it.",
  retryText = "Try again",
  containerStyle,
  buttonStyle,
  tags,
  hideRetryButton = false,
  children,
}: CustomErrorPageProps): ReactNode {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "custom-error-boundary", ...tags },
      extra: { digest: error.digest },
    });
  }, [error, tags]);

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      <h2 style={styles.heading}>{title}</h2>
      <p style={styles.message}>{message}</p>
      {children}
      {!hideRetryButton && (
        <button
          onClick={reset}
          style={{ ...styles.button, ...buttonStyle }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              styles.buttonHover.backgroundColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor =
              buttonStyle?.backgroundColor || styles.button.backgroundColor;
          }}
        >
          {retryText}
        </button>
      )}
    </div>
  );
}

// Re-export captureException for convenience
export { captureException } from "@bugwatch/core";
