"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboardingChecklist } from "@/hooks/useOnboardingChecklist";

const STORAGE_KEY = "bugwatch:onboarding_checklist_state";

interface ActivationChecklistProps {
  className?: string;
}

export function ActivationChecklist({ className }: ActivationChecklistProps) {
  const { milestones, completedCount, totalCount, isAllComplete } = useOnboardingChecklist();

  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Read dismissed state from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dismissed") setIsDismissed(true);
  }, []);

  function dismiss() {
    setIsDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    }
  }

  // Hide entirely once dismissed.
  if (isDismissed) return null;

  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={cn("border-t border-[hsl(var(--border-subtle))] overflow-hidden", className)}>
      {/*
       * Collapsed view — always visible in the narrow (w-14) sidebar.
       * Shows a small circular progress badge centred in the icon column.
       * group-hover hides it so the full expanded view takes over.
       */}
      <div className="flex items-center justify-center h-10 group-hover:hidden" aria-hidden="true">
        <div className="relative flex h-7 w-7 items-center justify-center">
          {/* SVG ring */}
          <svg viewBox="0 0 28 28" className="absolute inset-0 h-7 w-7 -rotate-90" aria-hidden="true">
            <circle cx="14" cy="14" r="11" fill="none" stroke="hsl(var(--border-subtle))" strokeWidth="2.5" />
            <circle
              cx="14"
              cy="14"
              r="11"
              fill="none"
              stroke="hsl(var(--accent))"
              strokeWidth="2.5"
              strokeDasharray={`${2 * Math.PI * 11}`}
              strokeDashoffset={`${2 * Math.PI * 11 * (1 - progressPct / 100)}`}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <span className="relative text-[9px] font-mono font-bold text-[hsl(var(--foreground))] leading-none">
            {completedCount}/{totalCount}
          </span>
        </div>
      </div>

      {/*
       * Expanded view — visible only when the sidebar is hovered/focused.
       * Uses opacity-0 → opacity-100 matching the sidebar's label pattern.
       */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-full">
        {/* Header row */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-left flex-1 min-w-0"
            aria-expanded={isExpanded}
            aria-controls="onboarding-checklist-items"
          >
            <span className="text-[10px] font-mono font-semibold tracking-wider text-[hsl(var(--muted-foreground))] uppercase truncate">
              Getting started
            </span>
            <span className="ml-auto shrink-0 text-[10px] font-mono text-[hsl(var(--accent))] font-bold">
              {completedCount}/{totalCount}
            </span>
          </button>

          {isAllComplete && (
            <button
              type="button"
              onClick={dismiss}
              className="ml-1.5 shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              aria-label="Dismiss onboarding checklist"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Thin progress bar */}
        <div className="mx-3 mb-2 h-0.5 rounded-full bg-[hsl(var(--surface-3))] overflow-hidden">
          <div
            className="h-full rounded-full bg-[hsl(var(--accent))] transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={totalCount}
          />
        </div>

        {/* Milestone list */}
        {isExpanded && (
          <ul id="onboarding-checklist-items" className="flex flex-col gap-0.5 pb-3 px-1.5">
            {milestones.map((milestone) => (
              <li key={milestone.id}>
                <Link
                  href={milestone.href}
                  className={cn(
                    "flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs transition-colors duration-100 group/row",
                    milestone.completed
                      ? "text-[hsl(var(--muted-foreground))]"
                      : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))]"
                  )}
                >
                  {milestone.completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" aria-hidden="true" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                  )}
                  <span className={cn("truncate leading-tight", milestone.completed && "line-through")}>
                    {milestone.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
