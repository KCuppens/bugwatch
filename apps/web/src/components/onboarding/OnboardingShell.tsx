"use client";

import { ChevronRight } from "lucide-react";

interface OnboardingShellProps {
  children: React.ReactNode;
}

export function OnboardingShell({ children }: OnboardingShellProps) {
  return (
    <div>
      {/* Progress header */}
      <div className="bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border-subtle))] px-6 py-3 flex items-center gap-3">
        <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">GETTING STARTED</span>
        <div className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-5 w-5 rounded-full bg-[hsl(var(--accent))] text-[#080B10] text-xs flex items-center justify-center font-bold">
              1
            </span>
            Create project
          </span>
          <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
          <span className="text-[hsl(var(--muted-foreground))]">Install SDK</span>
          <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
          <span className="text-[hsl(var(--muted-foreground))]">Verify</span>
        </div>
      </div>
      {children}
    </div>
  );
}
