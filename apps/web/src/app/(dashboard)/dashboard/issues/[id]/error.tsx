"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function IssueDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Error is already captured by Next.js instrumentation; log for local debugging
    if (process.env.NODE_ENV === "development") {
      console.error("[IssueDetail] render error:", error);
    }
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Failed to load issue</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Something went wrong while rendering this issue. This has been reported automatically.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-muted-foreground mt-2">
            Error ID: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
