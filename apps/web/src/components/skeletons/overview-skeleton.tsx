"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-card p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="h-9 w-9 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Search bar skeleton */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Content area: issue list + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Issue list */}
        <div className="lg:col-span-2 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-lg border-l-4 border-l-transparent bg-[hsl(var(--surface-1))] py-3 px-4"
              style={{ opacity: 1 - i * 0.1 }}
            >
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="surface-card p-4 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
          <div className="surface-card p-4 space-y-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
