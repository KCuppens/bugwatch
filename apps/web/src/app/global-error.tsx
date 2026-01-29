"use client";

import { useEffect } from "react";

/**
 * Global Error Boundary
 *
 * This component catches root-level errors in the Next.js app and reports them
 * to BugWatch. It provides a user-friendly error page with a retry option.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report the error to BugWatch
    import("@bugwatch/nextjs").then(({ captureException, setTag }) => {
      setTag("source", "bugwatch-self-monitoring");
      captureException(error, {
        tags: {
          mechanism: "global-error-boundary",
          digest: error.digest || "unknown",
        },
      });
    }).catch(() => {
      // BugWatch SDK not available, log to console as fallback
      console.error("[GlobalError] Unhandled error:", error);
    });
  }, [error]);

  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "#0f0f10",
            color: "#fafafa",
          }}
        >
          <div
            style={{
              maxWidth: "500px",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 600,
                marginBottom: "1rem",
              }}
            >
              Something went wrong
            </h1>
            <p
              style={{
                color: "#a1a1aa",
                marginBottom: "1.5rem",
              }}
            >
              An unexpected error occurred. Our team has been notified and is
              working to fix the issue.
            </p>
            <button
              onClick={() => reset()}
              style={{
                backgroundColor: "#3b82f6",
                color: "white",
                padding: "0.5rem 1.5rem",
                borderRadius: "0.375rem",
                border: "none",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
