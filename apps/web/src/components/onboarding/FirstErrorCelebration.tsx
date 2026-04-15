"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, CheckCircle2, ChevronRight } from "lucide-react";
import { useConfetti } from "@/hooks/useConfetti";
import { issuesApi } from "@/lib/api";
import type { Issue, IssueDetail } from "@/lib/api";

interface FirstErrorCelebrationProps {
  issue: Issue;
  onDismiss: () => void;
}

export function FirstErrorCelebration({ issue, onDismiss }: FirstErrorCelebrationProps) {
  const canvasRef = useConfetti({ trigger: true });
  const [issueDetail, setIssueDetail] = useState<IssueDetail | null>(null);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  // Fetch full issue detail for stack trace
  useEffect(() => {
    let cancelled = false;
    issuesApi
      .get(issue.project_id, issue.id)
      .then((res) => {
        if (!cancelled) setIssueDetail(res.data);
      })
      .catch(() => {
        // non-fatal — we still show summary without stack trace
      });
    return () => {
      cancelled = true;
    };
  }, [issue.project_id, issue.id]);

  // Prefer in-app frames; fall back to all frames if none are in-app
  const frames = issueDetail?.exception?.stacktrace ?? [];
  const inAppFrames = frames.filter((f) => f.in_app);
  const displayFrames = (inAppFrames.length > 0 ? inAppFrames : frames).slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {/* Confetti canvas */}
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-50" aria-hidden="true" />

      {/* Celebration card */}
      <div className="relative z-[60] w-full max-w-lg mx-4 surface-card p-8 rounded-2xl">
        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-4 right-4 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Success icon + heading */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-full bg-[hsl(var(--accent))]/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-6 w-6 text-[hsl(var(--accent))]" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Your first error was captured!</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">BugWatch is working.</p>
          </div>
        </div>

        {/* Error summary */}
        <div className="bg-[hsl(var(--surface-2))] rounded-lg p-4 mb-6 space-y-3">
          {/* Level badge + title */}
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400">{issue.level}</span>
            <p className="font-mono text-sm truncate">{issue.title}</p>
          </div>

          {/* Stack trace */}
          {displayFrames.length > 0 && (
            <div className="space-y-1">
              {displayFrames.map((frame, i) => (
                <div key={i} className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--foreground))]">{frame.function}</span> at{" "}
                  <span className="text-[hsl(var(--accent))]">
                    {frame.filename}:{frame.lineno}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CTA */}
        <Link
          href={`/dashboard/issues/${issue.id}?project=${issue.project_id}`}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#2ed573] text-[#080B10] font-semibold hover:bg-[#1a9e52] transition-colors"
        >
          View full issue <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
