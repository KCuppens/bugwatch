"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function IssueListSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
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

      {/* Issue rows skeleton */}
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border-l-4 border-l-transparent bg-card py-3 px-4"
            style={{ opacity: 1 - i * 0.08, animationDelay: `${i * 50}ms` }}
          >
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
