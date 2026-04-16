"use client";

export function ErrorFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-sm text-muted-foreground mb-4">Please refresh the page to try again.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
