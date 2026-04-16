"use client";

import { useState, useEffect, Dispatch, SetStateAction } from "react";
import {
  issuesApi,
  integrationsApi,
  replayApi,
  type IssueDetail,
  type FrequencyData,
  type ImpactData,
  type IssueComment,
  type IssueLinkInfo,
  type SessionRecording,
} from "@/lib/api";
import { toast } from "sonner";

interface UseIssueDataOptions {
  issueId: string;
  projectId: string | null;
  hasIntegrations: boolean;
  hasReplay: boolean;
}

interface UseIssueDataResult {
  issue: IssueDetail | null;
  setIssue: Dispatch<SetStateAction<IssueDetail | null>>;
  isLoading: boolean;
  error: string | null;
  frequencyData: FrequencyData | null;
  frequencyPeriod: "24h" | "7d" | "30d";
  setFrequencyPeriod: Dispatch<SetStateAction<"24h" | "7d" | "30d">>;
  frequencyLoading: boolean;
  impactData: ImpactData | null;
  impactLoading: boolean;
  comments: IssueComment[];
  setComments: Dispatch<SetStateAction<IssueComment[]>>;
  commentsLoading: boolean;
  linkedIssues: IssueLinkInfo[];
  setLinkedIssues: Dispatch<SetStateAction<IssueLinkInfo[]>>;
  issueReplay: SessionRecording | null;
}

/**
 * Encapsulates all remote data fetching for the issue detail page.
 * Keeping fetches here reduces the component file from ~1500 lines and
 * makes each concern independently testable.
 */
export function useIssueData({
  issueId,
  projectId,
  hasIntegrations,
  hasReplay,
}: UseIssueDataOptions): UseIssueDataResult {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frequencyData, setFrequencyData] = useState<FrequencyData | null>(null);
  const [frequencyPeriod, setFrequencyPeriod] = useState<"24h" | "7d" | "30d">("24h");
  const [frequencyLoading, setFrequencyLoading] = useState(false);

  const [impactData, setImpactData] = useState<ImpactData | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const [linkedIssues, setLinkedIssues] = useState<IssueLinkInfo[]>([]);
  const [issueReplay, setIssueReplay] = useState<SessionRecording | null>(null);

  // Primary fetch
  useEffect(() => {
    async function fetchIssue() {
      if (!projectId) {
        setError("No project selected");
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await issuesApi.get(projectId, issueId);
        setIssue(response.data);
      } catch {
        toast.error("Failed to load issue details");
        setError("Failed to load issue details. Please try again.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchIssue();
  }, [issueId, projectId]);

  // Dependent fetches — only run after the primary issue is loaded
  useEffect(() => {
    async function fetchLinkedIssues() {
      if (!projectId || !hasIntegrations) return;
      try {
        const response = await integrationsApi.listIssueLinks(projectId, issueId);
        setLinkedIssues(response.data);
      } catch (err) {
        console.debug("[issues] fetchLinkedIssues failed (non-critical):", err);
      }
    }
    if (issue) fetchLinkedIssues();
  }, [issueId, projectId, issue, hasIntegrations]);

  useEffect(() => {
    async function fetchFrequency() {
      if (!projectId) return;
      setFrequencyLoading(true);
      try {
        const response = await issuesApi.getFrequency(projectId, issueId, frequencyPeriod);
        setFrequencyData(response.data);
      } catch {
        setFrequencyData(null);
      } finally {
        setFrequencyLoading(false);
      }
    }
    if (issue) fetchFrequency();
  }, [issueId, projectId, frequencyPeriod, issue]);

  useEffect(() => {
    async function fetchImpact() {
      if (!projectId) return;
      setImpactLoading(true);
      try {
        const response = await issuesApi.getImpact(projectId, issueId);
        setImpactData(response.data);
      } catch {
        setImpactData(null);
      } finally {
        setImpactLoading(false);
      }
    }
    if (issue) fetchImpact();
  }, [issueId, projectId, issue]);

  useEffect(() => {
    async function fetchComments() {
      if (!projectId) return;
      setCommentsLoading(true);
      try {
        const response = await issuesApi.listComments(projectId, issueId);
        setComments(response.data);
      } catch {
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    }
    if (issue) fetchComments();
  }, [issueId, projectId, issue]);

  useEffect(() => {
    async function fetchReplay() {
      if (!projectId || !hasReplay) return;
      try {
        const response = await replayApi.getIssueReplay(projectId, issueId);
        setIssueReplay(response.data ?? null);
      } catch {
        setIssueReplay(null);
      }
    }
    if (issue) fetchReplay();
  }, [issueId, projectId, issue, hasReplay]);

  return {
    issue,
    setIssue,
    isLoading,
    error,
    frequencyData,
    frequencyPeriod,
    setFrequencyPeriod,
    frequencyLoading,
    impactData,
    impactLoading,
    comments,
    setComments,
    commentsLoading,
    linkedIssues,
    setLinkedIssues,
    issueReplay,
  };
}
