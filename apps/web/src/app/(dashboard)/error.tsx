"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Dashboard Error Boundary
 *
 * This component catches errors within the dashboard routes and reports them
 * to BugWatch. It provides a styled error page consistent with the dashboard UI.
 */
export default function DashboardError({
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
          mechanism: "dashboard-error-boundary",
          digest: error.digest || "unknown",
        },
      });
    }).catch(() => {
      // BugWatch SDK not available, log to console as fallback
      console.error("[DashboardError] Unhandled error:", error);
    });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="p-3 rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground">
          An error occurred while loading this page. Our team has been notified
          and is working to resolve the issue.
        </p>
        <div className="flex gap-3 mt-4">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.href = "/dashboard"}>
            Go to Dashboard
          </Button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <details className="mt-6 w-full text-left">
            <summary className="text-sm text-muted-foreground cursor-pointer">
              Error details (development only)
            </summary>
            <pre className="mt-2 p-4 bg-muted rounded-md text-xs overflow-auto">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
