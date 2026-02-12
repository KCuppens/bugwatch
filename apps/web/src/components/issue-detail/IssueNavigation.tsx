"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface IssueNavigationProps {
  currentIssueId: string;
  projectId: string | null;
}

export function IssueNavigation({ currentIssueId, projectId }: IssueNavigationProps) {
  const router = useRouter();
  const [position, setPosition] = useState<{ current: number; total: number } | null>(null);
  const [prevId, setPrevId] = useState<string | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    try {
      const stored = sessionStorage.getItem(`bugwatch:issue-order:${projectId}`);
      if (!stored) return;

      const issueOrder: string[] = JSON.parse(stored);
      const currentIndex = issueOrder.indexOf(currentIssueId);
      if (currentIndex === -1) return;

      setPosition({ current: currentIndex + 1, total: issueOrder.length });
      setPrevId(currentIndex > 0 ? issueOrder[currentIndex - 1] ?? null : null);
      setNextId(currentIndex < issueOrder.length - 1 ? issueOrder[currentIndex + 1] ?? null : null);
    } catch {
      // Ignore storage errors
    }
  }, [currentIssueId, projectId]);

  const navigateTo = useCallback((id: string) => {
    router.push(`/dashboard/issues/${id}?project=${projectId}`);
  }, [router, projectId]);

  // Keyboard shortcuts: [ for prev, ] for next
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "[" && prevId) {
        e.preventDefault();
        navigateTo(prevId);
      } else if (e.key === "]" && nextId) {
        e.preventDefault();
        navigateTo(nextId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevId, nextId, navigateTo]);

  if (!position) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground mr-1">
        {position.current} of {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!prevId}
        onClick={() => prevId && navigateTo(prevId)}
        title="Previous issue ([)"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!nextId}
        onClick={() => nextId && navigateTo(nextId)}
        title="Next issue (])"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
