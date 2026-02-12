"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function IssueDetailSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Sticky header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Tab bar skeleton */}
          <div className="flex gap-1 border-b pb-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
          {/* Stack frames skeleton */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-4" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
              {i === 0 && (
                <div className="space-y-1 pt-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full bg-red-500/10" />
                  <Skeleton className="h-4 w-full" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Stats skeleton */}
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-1.5">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
          {/* Chart skeleton */}
          <div className="rounded-lg border p-4">
            <Skeleton className="h-4 w-32 mb-3" />
            <Skeleton className="h-32 w-full rounded" />
          </div>
          {/* Tags skeleton */}
          <div className="rounded-lg border p-4 space-y-2">
            <Skeleton className="h-4 w-16" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-6 w-28 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
