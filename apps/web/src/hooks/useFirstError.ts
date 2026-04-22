"use client";

import { useState, useEffect, useRef } from "react";
import { useProject } from "@/lib/project-context";
import { useOnboarding } from "@/lib/onboarding-context";
import { issuesApi } from "@/lib/api";
import type { Issue } from "@/lib/api";

const CELEBRATED_KEY = "bugwatch:first_error_celebrated";

interface UseFirstErrorReturn {
  firstIssue: Issue | null;
  shouldCelebrate: boolean;
  dismiss: () => void;
}

export function useFirstError(): UseFirstErrorReturn {
  const { selectedProject } = useProject();
  const { checklist, markMilestone } = useOnboarding();

  // Read localStorage inside an effect to avoid SSR access and hydration
  // mismatch. Start optimistic (not celebrated); the effect below promotes
  // the ref and flag if a previous dismissal is persisted.
  const [alreadyCelebrated, setAlreadyCelebrated] = useState(false);

  const [firstIssue, setFirstIssue] = useState<Issue | null>(null);
  const [shouldCelebrate, setShouldCelebrate] = useState(false);
  const celebratedRef = useRef<boolean>(checklist.first_error);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(CELEBRATED_KEY) === "true") {
      celebratedRef.current = true;
      setAlreadyCelebrated(true);
    }
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(CELEBRATED_KEY, "true");
    }
    setShouldCelebrate(false);
    setFirstIssue(null);
  };

  useEffect(() => {
    // Skip if already celebrated or milestone already marked
    if (celebratedRef.current) return;
    if (!selectedProject) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || celebratedRef.current) return;
      try {
        const response = await issuesApi.list(selectedProject.id, { page: 1, status: "unresolved" });
        if (cancelled || celebratedRef.current) return;
        const issues = response.data;
        if (issues.length > 0) {
          celebratedRef.current = true;
          setFirstIssue(issues[0] ?? null);
          setShouldCelebrate(true);
          markMilestone("first_error");
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error("[useFirstError] Polling error:", err);
      }
    };

    // Poll immediately, then every 10 seconds
    void poll();
    const intervalId = setInterval(() => void poll(), 10_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedProject, markMilestone]);

  if (alreadyCelebrated || checklist.first_error) {
    return { firstIssue: null, shouldCelebrate: false, dismiss: () => {} };
  }

  return { firstIssue, shouldCelebrate, dismiss };
}
