"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Tab bar skeleton */}
      <div className="flex items-center gap-2 border-b pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* Settings cards skeleton */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-6 space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-48 rounded-md" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-48 rounded-md" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
