"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  Tag,
  ChevronRight,
  CheckCircle,
  XCircle,
  Copy,
  Loader2,
  Globe,
  User,
  Code,
  Clipboard,
  Link as LinkIcon,
  Terminal,
  Filter,
  Flame,
  TrendingDown,
  BarChart3,
  Monitor,
  MessageSquare,
  Send,
  Trash2,
  Edit3,
  ArrowRightLeft,
  GitBranch,
  Video,
} from "lucide-react";
import { issuesApi, type BreadcrumbDetail, type EventDetail } from "@/lib/api";
import { ENVIRONMENT_COLORS } from "@/lib/search";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StackFrame } from "@/components/issue-detail/StackFrame";
import { IssueNavigation } from "@/components/issue-detail/IssueNavigation";
import { IssueDetailSkeleton } from "@/components/skeletons/issue-detail-skeleton";
import { CreateIssueDialog, LinkedIssues } from "@/components/integrations";
import { useFeature } from "@/hooks/use-feature";
import { useIssueData } from "@/hooks/useIssueData";
import { toast } from "sonner";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "-";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getBreadcrumbIcon(type: string, category: string) {
  if (type === "navigation" || category === "navigation") return Globe;
  if (type === "http" || category === "xhr" || category === "fetch") return ArrowRightLeft;
  if (type === "console" || category === "console") return Terminal;
  if (type === "error" || category === "error") return AlertCircle;
  return Code;
}

function BreadcrumbData({
  type,
  category,
  data,
}: {
  type: string;
  category: string;
  data: Record<string, unknown>;
}) {
  const isHttp = type === "http" || category === "xhr" || category === "fetch";
  const isNav = type === "navigation" || category === "navigation";
  const isConsole = type === "console" || category === "console";

  if (isHttp) {
    const status = data.status_code ?? data.status;
    const method = data.method;
    const url = data.url;
    const statusNum = typeof status === "number" ? status : parseInt(String(status ?? ""), 10);
    const statusColor = !isNaN(statusNum)
      ? statusNum >= 500
        ? "text-red-500"
        : statusNum >= 400
          ? "text-orange-500"
          : statusNum >= 300
            ? "text-yellow-500"
            : "text-green-500"
      : "text-muted-foreground";
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-mono">
        {status != null && <span className={`font-bold ${statusColor}`}>{String(status)}</span>}
        {Boolean(method) && <span className="text-muted-foreground">{String(method)}</span>}
        {Boolean(url) && <span className="text-muted-foreground truncate max-w-xs">{String(url)}</span>}
      </div>
    );
  }

  if (isNav && (data.from || data.to)) {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
        {Boolean(data.from) && <span className="truncate max-w-[120px]">{String(data.from)}</span>}
        {Boolean(data.from) && Boolean(data.to) && <span>→</span>}
        {Boolean(data.to) && <span className="truncate max-w-[120px]">{String(data.to)}</span>}
      </div>
    );
  }

  if (isConsole && data.arguments) {
    const args = Array.isArray(data.arguments) ? data.arguments : [data.arguments];
    return (
      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground truncate">
        {args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(", ")}
      </div>
    );
  }

  const entries = Object.entries(data).slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
          <span className="text-muted-foreground">{k}:</span>{" "}
          {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v)}
        </span>
      ))}
    </div>
  );
}

function DistributionBars({
  label,
  items,
}: {
  label: string;
  items: { name: string; count: number; percentage: number }[];
}) {
  const top = items.slice(0, 5);
  const maxPct = Math.max(...top.map((i) => i.percentage), 1);
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
      <div className="space-y-1">
        {top.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-24 truncate shrink-0">{item.name}</span>
            <div
              className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"
              role="meter"
              aria-label={`${item.name}: ${item.percentage}%`}
              aria-valuenow={item.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-accent-2/60"
                style={{ width: `${(item.percentage / maxPct) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground w-8 text-right shrink-0" aria-hidden="true">
              {item.percentage}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const issueId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const projectId = searchParams.get("project");

  const hasIntegrations = useFeature("github");
  const hasReplay = useFeature("session_replay");

  // All remote data fetching is centralised in this hook
  const {
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
  } = useIssueData({ issueId, projectId, hasIntegrations, hasReplay });

  // Core UI state
  const [activeTab, setActiveTab] = useState<"debug" | "timeline" | "context">(() => {
    const tab = searchParams.get("tab");
    if (tab === "timeline" || tab === "context") return tab;
    return "debug";
  });

  // Sync tab to URL so refresh/back preserves context
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeTab === "debug") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", activeTab);
    }
    window.history.replaceState(null, "", url.toString());
  }, [activeTab]);
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set([0]));
  const [showAppOnly, setShowAppOnly] = useState(false);
  // Single pending-action flag prevents simultaneous resolve+ignore race via keyboard shortcuts
  const [pendingAction, setPendingAction] = useState<"resolve" | "ignore" | null>(null);
  // Ref mirrors pendingAction so the undo toast closure can read the live value without stale capture
  const pendingActionRef = useRef<"resolve" | "ignore" | null>(null);
  // Ref mirrors the current issue status so undo closures can check for staleness
  const issueStatusRef = useRef<string | undefined>(undefined);

  // Event inspector
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventModalTab, setEventModalTab] = useState<"exception" | "request" | "breadcrumbs" | "meta">("exception");
  const [modalExpandedFrames, setModalExpandedFrames] = useState<Set<number>>(new Set([0]));
  const eventControllerRef = useRef<AbortController | null>(null);

  // Breadcrumb filter
  const [breadcrumbFilter, setBreadcrumbFilter] = useState<string>("all");

  const filteredBreadcrumbs = useMemo(() => {
    if (!issue?.breadcrumbs) return [];
    return issue.breadcrumbs.filter((crumb) => {
      if (breadcrumbFilter === "all") return true;
      const cat = ((crumb.category ?? "") || (crumb.type ?? "")).toLowerCase();
      if (breadcrumbFilter === "http") return ["http", "xhr", "fetch"].includes(cat);
      if (breadcrumbFilter === "navigation") return cat === "navigation";
      if (breadcrumbFilter === "console") return cat === "console";
      if (breadcrumbFilter === "error") return crumb.level === "error";
      return true;
    });
  }, [issue?.breadcrumbs, breadcrumbFilter]);

  const chartBuckets = useMemo(() => {
    if (!frequencyData) return [];
    if (frequencyPeriod === "24h") {
      return frequencyData.buckets.reduce<{ timestamp: string; count: number }[]>((acc, b, i) => {
        const gi = Math.floor(i / 4);
        if (!acc[gi]) acc[gi] = { timestamp: b.timestamp, count: 0 };
        acc[gi]!.count += b.count;
        return acc;
      }, []);
    }
    return frequencyData.buckets;
  }, [frequencyData, frequencyPeriod]);

  const chartMax = useMemo(() => Math.max(...chartBuckets.map((b) => b.count), 1), [chartBuckets]);

  // Comments (UI-only state — data comes from hook)
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [showAllComments, setShowAllComments] = useState(false);

  // Linked issues (UI-only state — data comes from hook)
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  // Auto-resize textarea ref
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // Detect Mac platform once on mount to avoid SSR/hydration mismatch
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setIsMac(nav.userAgentData?.platform === "macOS" || /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);

  // Keep issueStatusRef in sync so undo closures can detect stale status
  useEffect(() => {
    issueStatusRef.current = issue?.status;
  }, [issue?.status]);

  // Auto-expand in-app frames
  useEffect(() => {
    if (issue?.exception?.stacktrace) {
      const inAppIndices = issue.exception.stacktrace.map((f, i) => (f.in_app ? i : -1)).filter((i) => i !== -1);
      setExpandedFrames(new Set(inAppIndices.length > 0 ? inAppIndices : [0]));
    }
  }, [issue]);

  // Shared status-change handler — handles optimistic update, undo toast, and rollback
  const handleStatusChange = useCallback(
    async function (
      actionKey: "resolve" | "ignore",
      newStatus: "resolved" | "ignored",
      successMsg: string,
      errorMsg: string
    ) {
      if (!issue || !projectId) return;
      const prev = issue.status;
      pendingActionRef.current = actionKey;
      setPendingAction(actionKey);
      setIssue({ ...issue, status: newStatus });

      const toastId = toast.success(successMsg, {
        action: {
          label: "Undo",
          onClick: async () => {
            // Guard: don't undo while the original call is still in-flight
            if (pendingActionRef.current !== null) return;
            // Guard: bail if the status has already changed to something else
            // (e.g. another action fired while the toast was visible)
            if (issueStatusRef.current !== newStatus) return;
            if (!projectId) return;
            setIssue((i) => (i ? { ...i, status: prev } : i));
            try {
              await issuesApi.update(projectId, issueId, prev);
            } catch {
              toast.error("Failed to undo");
            }
          },
        },
      });

      try {
        await issuesApi.update(projectId, issueId, newStatus);
      } catch {
        toast.dismiss(toastId);
        setIssue((i) => (i ? { ...i, status: prev } : i));
        toast.error(errorMsg);
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    },
    [issue, projectId, issueId]
  );

  const handleResolve = useCallback(
    async function () {
      await handleStatusChange("resolve", "resolved", "Issue resolved", "Failed to resolve issue");
    },
    [handleStatusChange]
  );

  const handleIgnore = useCallback(
    async function () {
      await handleStatusChange("ignore", "ignored", "Issue ignored", "Failed to ignore issue");
    },
    [handleStatusChange]
  );

  const handleCopyForAi = useCallback(() => {
    if (!issue) return;
    const jsonBlock = (v: unknown) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";

    const lines: string[] = [
      "# Error Report",
      "",
      `**Error Type:** ${issue.exception?.type || "Unknown"}`,
      `**Message:** ${issue.exception?.value || issue.title}`,
      `**Level:** ${issue.level}`,
      `**Status:** ${issue.status}`,
      `**Environment:** ${issue.environment}`,
      `**First Seen:** ${issue.first_seen}`,
      `**Last Seen:** ${issue.last_seen}`,
      `**Occurrences:** ${issue.count} events`,
      `**Affected Users:** ${issue.user_count} users`,
      "",
    ];

    if (issue.exception?.stacktrace?.length) {
      lines.push("## Stack Trace", "");
      issue.exception.stacktrace.forEach((f, i) => {
        const loc = `${f.filename}:${f.lineno}${f.colno ? `:${f.colno}` : ""}`;
        const appTag = f.in_app ? "[in-app] " : "";
        lines.push(`### Frame ${i + 1}: ${appTag}${f.function || "(anonymous)"} at ${loc}`);
        if (f.pre_context?.length) {
          lines.push("```");
          f.pre_context.forEach((l) => lines.push(l));
          lines.push("```");
        }
        if (f.context_line) {
          lines.push(`> \`${f.context_line.trim()}\``);
        }
        if (f.post_context?.length) {
          lines.push("```");
          f.post_context.forEach((l) => lines.push(l));
          lines.push("```");
        }
        if (f.vars && Object.keys(f.vars).length > 0) {
          lines.push("**Local Variables:**", jsonBlock(f.vars));
        }
        lines.push("");
      });
    }

    if (issue.breadcrumbs?.length) {
      const crumbs = issue.breadcrumbs.slice(-20);
      lines.push("## Breadcrumbs", "");
      lines.push("| Time | Type | Category | Level | Message |");
      lines.push("|------|------|----------|-------|---------|");
      crumbs.forEach((b) => {
        const msg = (b.message || "").replace(/\|/g, "\\|");
        lines.push(`| ${b.timestamp} | ${b.type} | ${b.category} | ${b.level} | ${msg} |`);
        if (b.data && Object.keys(b.data).length > 0) {
          lines.push(`  - data: ${JSON.stringify(b.data)}`);
        }
      });
      lines.push("");
    }

    if (issue.request) {
      lines.push("## HTTP Request", "");
      if (issue.request.method || issue.request.url) {
        lines.push(`**URL:** ${issue.request.method || "GET"} ${issue.request.url || ""}`);
      }
      if (issue.request.query_string) {
        lines.push(`**Query:** ${issue.request.query_string}`);
      }
      if (issue.request.headers && Object.keys(issue.request.headers).length > 0) {
        lines.push("**Headers:**", "```");
        Object.entries(issue.request.headers).forEach(([k, v]) => lines.push(`${k}: ${v}`));
        lines.push("```");
      }
      if (issue.request.data) {
        lines.push("**Body:**", jsonBlock(issue.request.data));
      }
      lines.push("");
    }

    if (issue.user) {
      lines.push("## User", "");
      if (issue.user.id) lines.push(`**ID:** ${issue.user.id}`);
      if (issue.user.email) lines.push(`**Email:** ${issue.user.email}`);
      if (issue.user.username) lines.push(`**Username:** ${issue.user.username}`);
      if (issue.user.ip_address) lines.push(`**IP:** ${issue.user.ip_address}`);
      if (issue.user.extra && Object.keys(issue.user.extra).length > 0) {
        lines.push("**Extra:**", jsonBlock(issue.user.extra));
      }
      lines.push("");
    }

    if (issue.tags && Object.keys(issue.tags).length > 0) {
      lines.push("## Tags", "");
      Object.entries(issue.tags).forEach(([k, v]) => lines.push(`- **${k}:** ${v}`));
      lines.push("");
    }

    if (issue.extra && Object.keys(issue.extra).length > 0) {
      lines.push("## Extra Data", "", jsonBlock(issue.extra), "");
    }

    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => toast.success("Copied for AI assistant — includes user identifiers"))
      .catch(() => toast.error("Copy failed"));
  }, [issue]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "r":
          if (issue?.status !== "resolved" && !pendingAction) {
            e.preventDefault();
            handleResolve();
          }
          break;
        case "i":
        case "m":
        case "e":
          if (issue?.status !== "ignored" && !pendingAction) {
            e.preventDefault();
            handleIgnore();
          }
          break;
        case "c":
          e.preventDefault();
          handleCopyForAi();
          break;
        case "u":
          // Up to list
          e.preventDefault();
          router.push(projectId ? `/dashboard?project=${projectId}` : "/dashboard");
          break;
        case "1":
          e.preventDefault();
          setActiveTab("debug");
          break;
        case "2":
          e.preventDefault();
          setActiveTab("timeline");
          break;
        case "3":
          e.preventDefault();
          setActiveTab("context");
          break;
        case "escape":
          if (selectedEventId) closeEventModal();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [issue, pendingAction, selectedEventId, router, projectId, handleResolve, handleIgnore, handleCopyForAi]);

  // Update browser tab title to show which issue is being viewed
  useEffect(() => {
    if (issue) {
      document.title = `${issue.title} — Bugwatch`;
      return () => {
        document.title = "Bugwatch";
      };
    }
  }, [issue?.title]);

  const toggleFrame = useCallback((index: number) => {
    setExpandedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  function handleCopyLink() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Copy failed"));
  }

  function handleCopyCurl() {
    if (!issue?.request) return;
    // Escape backslashes then double-quotes so values are safe inside double-quoted shell strings
    const shellEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const parts: string[] = ["curl"];
    const method = issue.request.method || "GET";
    if (method !== "GET") parts.push(`-X ${shellEscape(method)}`);
    let url = issue.request.url || "";
    if (issue.request.query_string && !url.includes("?")) url += `?${issue.request.query_string}`;
    const sensitive = ["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "x-csrf-token", "x-xsrf-token", "proxy-authorization"];
    if (issue.request.headers) {
      Object.entries(issue.request.headers).forEach(([key, value]) => {
        const safeKey = shellEscape(key);
        parts.push(
          sensitive.includes(key.toLowerCase())
            ? `-H "${safeKey}: [REDACTED]"`
            : `-H "${safeKey}: ${shellEscape(String(value))}"`
        );
      });
    }
    parts.push(`"${shellEscape(url)}"`);
    navigator.clipboard
      .writeText(parts.join(" \\\n  "))
      .then(() => toast.success("cURL command copied"))
      .catch(() => toast.error("Copy failed"));
  }

  async function handleEventClick(eventId: string) {
    if (!projectId) return;
    eventControllerRef.current?.abort();
    const controller = new AbortController();
    eventControllerRef.current = controller;
    setSelectedEventId(eventId);
    setEventLoading(true);
    setEventDetail(null);
    setEventModalTab("exception");
    setModalExpandedFrames(new Set([0]));
    try {
      const response = await issuesApi.getEvent(projectId, issueId, eventId);
      if (controller.signal.aborted) return;
      setEventDetail(response.data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (controller.signal.aborted) return;
      toast.error("Failed to load event details");
    } finally {
      if (!controller.signal.aborted) setEventLoading(false);
    }
  }

  function closeEventModal() {
    setSelectedEventId(null);
    setEventDetail(null);
  }

  async function handleSubmitComment() {
    if (!projectId || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const response = await issuesApi.createComment(projectId, issueId, newComment.trim());
      setComments((prev) => [response.data, ...prev]);
      setNewComment("");
      if (commentRef.current) commentRef.current.style.height = "auto";
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleUpdateComment(commentId: string) {
    if (!projectId || !editingContent.trim()) return;
    try {
      const response = await issuesApi.updateComment(projectId, issueId, commentId, editingContent.trim());
      setComments((prev) => prev.map((c) => (c.id === commentId ? response.data : c)));
      setEditingCommentId(null);
      setEditingContent("");
      toast.success("Comment updated");
    } catch {
      toast.error("Failed to update comment");
    }
  }

  function handleDeleteComment(commentId: string) {
    if (!projectId) return;
    toast("Delete this comment?", {
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await issuesApi.deleteComment(projectId, issueId, commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId));
            toast.success("Comment deleted");
          } catch {
            toast.error("Failed to delete comment");
          }
        },
      },
      cancel: { label: "Cancel", onClick: () => {} },
    });
  }

  // Auto-resize textarea
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewComment(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  // Memoised before early returns (hooks must not be called conditionally).
  // Depends on issue?.exception?.stacktrace (not a derived `|| []` local) to keep the reference stable.
  const displayFrames = useMemo(() => {
    const frames = issue?.exception?.stacktrace ?? [];
    if (showAppOnly) {
      return frames.map((f, i) => ({ frame: f, originalIndex: i })).filter(({ frame }) => frame.in_app);
    }
    return frames.map((f, i) => ({ frame: f, originalIndex: i }));
  }, [issue?.exception?.stacktrace, showAppOnly]);

  if (isLoading) return <IssueDetailSkeleton />;

  if (error || !issue) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center min-h-[400px] space-y-4 animate-fade-in-up"
      >
        <AlertCircle aria-hidden="true" className="h-12 w-12 text-destructive" />
        <h2 className="font-display text-heading-md">Failed to load issue</h2>
        <p className="text-muted-foreground">{error || "Issue not found"}</p>
        <Link href="/dashboard">
          <Button>Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const stacktrace = issue.exception?.stacktrace || [];

  return (
    <div className="space-y-4">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={projectId ? `/dashboard?project=${projectId}` : "/dashboard"}>
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label="Back to dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
            <div
              role="img"
              aria-label={`Level: ${issue.level}`}
              className={`shrink-0 rounded-md p-1.5 ${
                issue.level === "fatal"
                  ? "bg-red-100 dark:bg-red-950"
                  : issue.level === "error"
                    ? "bg-orange-100 dark:bg-orange-950"
                    : issue.level === "warning"
                      ? "bg-yellow-100 dark:bg-yellow-950"
                      : "bg-blue-100 dark:bg-blue-950"
              }`}
            >
              <AlertCircle
                aria-hidden="true"
                className={`h-4 w-4 ${
                  issue.level === "fatal"
                    ? "text-red-600"
                    : issue.level === "error"
                      ? "text-orange-600"
                      : issue.level === "warning"
                        ? "text-yellow-600"
                        : "text-blue-600"
                }`}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight truncate">{issue.title}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{issue.count} events</span>
                <span>·</span>
                <span>{issue.user_count} users</span>
                {issue.environment && (
                  <>
                    <span>·</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        (ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.bg
                      } ${(ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.text}`}
                    >
                      {issue.environment}
                    </span>
                  </>
                )}
                {issue.status !== "unresolved" && (
                  <>
                    <span>·</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        issue.status === "resolved"
                          ? "bg-bug text-bug-foreground"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {issue.status}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <IssueNavigation currentIssueId={issueId} projectId={projectId} />
            <div className="h-5 w-px bg-border mx-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleResolve}
              disabled={!!pendingAction || issue.status === "resolved"}
              aria-keyshortcuts="r"
              aria-busy={pendingAction === "resolve"}
              className="h-8"
            >
              {pendingAction === "resolve" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Resolving…</span>
                </>
              ) : (
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
              )}
              <span className="ml-1.5 hidden sm:inline">{issue.status === "resolved" ? "Resolved" : "Resolve"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Action Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleIgnore}
          disabled={!!pendingAction || issue.status === "ignored"}
          aria-keyshortcuts="i m e"
          aria-busy={pendingAction === "ignore"}
          className="h-7 text-xs"
        >
          {pendingAction === "ignore" ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
              <span className="sr-only">Ignoring…</span>
            </>
          ) : (
            <XCircle className="mr-1.5 h-3 w-3" aria-hidden="true" />
          )}
          {issue.status === "ignored" ? "Ignored" : "Ignore"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-7 text-xs">
          <LinkIcon className="mr-1.5 h-3 w-3" />
          Copy Link
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyForAi} className="h-7 text-xs">
          <Clipboard className="mr-1.5 h-3 w-3" />
          Copy for AI
        </Button>
        {hasIntegrations && (
          <Button variant="outline" size="sm" onClick={() => setCreateIssueOpen(true)} className="h-7 text-xs">
            <GitBranch className="mr-1.5 h-3 w-3" />
            Create Issue
          </Button>
        )}
      </div>

      {/* ═══════ TWO-COLUMN LAYOUT ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* ── LEFT COLUMN: Tabs + Content ── */}
        <div className="space-y-4 min-w-0">
          {/* Tabs */}
          <div className="border-b">
            {(() => {
              const tabs = ["debug", "timeline", "context"] as const;
              return (
                <div
                  role="tablist"
                  aria-label="Issue detail sections"
                  className="flex gap-1"
                  onKeyDown={(e) => {
                    const currentIdx = tabs.indexOf(activeTab);
                    if (e.key === "ArrowRight") {
                      const next = tabs[(currentIdx + 1) % tabs.length]!;
                      setActiveTab(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    } else if (e.key === "ArrowLeft") {
                      const prev = tabs[(currentIdx - 1 + tabs.length) % tabs.length]!;
                      setActiveTab(prev);
                      document.getElementById(`tab-${prev}`)?.focus();
                    }
                  }}
                >
                  {[
                    { id: "debug" as const, label: "Stack Trace", icon: Code },
                    { id: "timeline" as const, label: "Timeline", icon: Clock },
                    { id: "context" as const, label: "Context", icon: Globe },
                  ].map((tab) => {
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        id={`tab-${tab.id}`}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`tabpanel-${tab.id}`}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                          activeTab === tab.id
                            ? "border-accent-2 text-accent-2"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        }`}
                      >
                        <TabIcon className="h-4 w-4" aria-hidden="true" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Debug Tab - Stack Trace */}
          {activeTab === "debug" && (
            <div id="tabpanel-debug" role="tabpanel" aria-labelledby="tab-debug" tabIndex={0} className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-sm">
                    {issue.exception?.type}: {issue.exception?.value}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {stacktrace.length} frames, {stacktrace.filter((f) => f.in_app).length} in-app
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(stacktrace.map((f) => `  at ${f.function} (${f.filename}:${f.lineno})`).join("\n"))
                      .then(() => toast.success("Stack trace copied"))
                      .catch(() => toast.error("Failed to copy stack trace"));
                  }}
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy
                </Button>
              </div>

              {/* Stack trace controls */}
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setShowAppOnly(!showAppOnly)}
                  aria-pressed={showAppOnly}
                  aria-label={showAppOnly ? "Show all frames" : "Show app frames only"}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    showAppOnly
                      ? "bg-accent-2 text-accent-2-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Filter className="h-3 w-3" aria-hidden="true" />
                  App Only
                </button>
                <button
                  onClick={() => {
                    const framesToExpand = showAppOnly
                      ? stacktrace
                          .map((f, i) => ({ f, i }))
                          .filter(({ f }) => f.in_app)
                          .map(({ i }) => i)
                      : stacktrace.map((_, i) => i);
                    setExpandedFrames(new Set(framesToExpand));
                  }}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedFrames(new Set())}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  Collapse All
                </button>
                {showAppOnly && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    Showing {stacktrace.filter((f) => f.in_app).length} of {stacktrace.length} frames
                  </span>
                )}
              </div>

              {/* HTTP Request/Response Payload */}
              {issue.extra &&
                !!(issue.extra.request_body || issue.extra.response_body) &&
                (() => {
                  const reqBody = issue.extra.request_body ? String(issue.extra.request_body) : "";
                  const resBody = issue.extra.response_body ? String(issue.extra.response_body) : "";
                  const durationMs = issue.extra.duration_ms != null ? String(issue.extra.duration_ms) : "";
                  const formatBody = (raw: string) => {
                    try {
                      return JSON.stringify(JSON.parse(raw), null, 2);
                    } catch {
                      return raw;
                    }
                  };

                  return (
                    <div className="rounded-lg border border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20 p-4 mb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowRightLeft className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        <span className="font-semibold text-sm">HTTP Payload</span>
                        {durationMs && <span className="text-xs text-muted-foreground ml-auto">{durationMs}ms</span>}
                      </div>
                      <div className="space-y-3">
                        {reqBody && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Request Body
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => {
                                  navigator.clipboard.writeText(reqBody);
                                  toast.success("Request body copied");
                                }}
                              >
                                <Copy className="mr-1 h-2.5 w-2.5" />
                                Copy
                              </Button>
                            </div>
                            <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono max-h-48 overflow-y-auto">
                              {formatBody(reqBody)}
                            </pre>
                          </div>
                        )}
                        {resBody && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Response Body
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => {
                                  navigator.clipboard.writeText(resBody);
                                  toast.success("Response body copied");
                                }}
                              >
                                <Copy className="mr-1 h-2.5 w-2.5" />
                                Copy
                              </Button>
                            </div>
                            <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono max-h-48 overflow-y-auto">
                              {formatBody(resBody)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {stacktrace.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No stack trace available</p>
              ) : (
                displayFrames.map(({ frame, originalIndex }) => (
                  <StackFrame
                    key={originalIndex}
                    frame={frame}
                    index={originalIndex}
                    isExpanded={expandedFrames.has(originalIndex)}
                    onToggle={() => toggleFrame(originalIndex)}
                  />
                ))
              )}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === "timeline" && (
            <div
              id="tabpanel-timeline"
              role="tabpanel"
              aria-labelledby="tab-timeline"
              tabIndex={0}
              className="space-y-4"
            >
              {/* Breadcrumbs */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Breadcrumbs ({issue.breadcrumbs?.length || 0})</CardTitle>
                    {issue.breadcrumbs && issue.breadcrumbs.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <select
                          value={breadcrumbFilter}
                          onChange={(e) => setBreadcrumbFilter(e.target.value)}
                          aria-label="Filter breadcrumbs by type"
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="all">All</option>
                          <option value="http">HTTP</option>
                          <option value="navigation">Navigation</option>
                          <option value="console">Console</option>
                          <option value="error">Errors</option>
                        </select>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!issue.breadcrumbs || issue.breadcrumbs.length === 0 ? (
                    <p className="text-center text-muted-foreground py-6 text-sm">No breadcrumbs captured</p>
                  ) : (
                    (() => {
                      const filtered = filteredBreadcrumbs;
                      if (filtered.length === 0)
                        return (
                          <p className="text-center text-muted-foreground py-6 text-sm">No matching breadcrumbs</p>
                        );

                      return (
                        <div className="relative">
                          <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />
                          <div className="space-y-2">
                            {filtered.map((crumb: BreadcrumbDetail, index: number) => {
                              const isError = crumb.level === "error";
                              const CrumbIcon = getBreadcrumbIcon(crumb.type, crumb.category);
                              const dotColor = isError
                                ? "bg-red-500"
                                : crumb.type === "http" || crumb.category === "xhr"
                                  ? "bg-blue-500"
                                  : crumb.type === "navigation"
                                    ? "bg-green-500"
                                    : "bg-gray-400";

                              // Time gap indicator
                              const prevCrumb = index > 0 ? filtered[index - 1] : null;
                              const gap = prevCrumb
                                ? (new Date(crumb.timestamp).getTime() - new Date(prevCrumb.timestamp).getTime()) / 1000
                                : 0;

                              return (
                                <div key={`${crumb.timestamp}-${index}`}>
                                  {gap > 1 && (
                                    <div className="relative flex items-center pl-8 py-1">
                                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-b border-dashed border-muted flex-1">
                                        <span>
                                          +
                                          {gap < 60
                                            ? `${gap.toFixed(1)}s`
                                            : `${Math.floor(gap / 60)}m ${Math.round(gap % 60)}s`}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  <div className="relative flex items-start gap-3 pl-8">
                                    <div
                                      aria-hidden="true"
                                      className={`absolute left-1.5 top-2 h-3 w-3 rounded-full ${dotColor} ring-2 ring-background flex items-center justify-center`}
                                    >
                                      <CrumbIcon className="h-1.5 w-1.5 text-white" />
                                    </div>
                                    <div
                                      className={`flex-1 rounded-md border p-2 text-sm ${isError ? "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20" : "bg-muted/30"}`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground font-mono">
                                          {new Date(crumb.timestamp).toLocaleTimeString()}
                                        </span>
                                        <span
                                          className={`text-xs px-1 py-0.5 rounded ${isError ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted"}`}
                                        >
                                          {crumb.category || crumb.type}
                                        </span>
                                      </div>
                                      <p
                                        className={`text-xs mt-1 ${isError ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}
                                      >
                                        {crumb.message || "(no message)"}
                                      </p>
                                      {crumb.data && Object.keys(crumb.data).length > 0 && (
                                        <BreadcrumbData type={crumb.type} category={crumb.category} data={crumb.data} />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </CardContent>
              </Card>

              {/* Events */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Recent Events ({issue.recent_events.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {issue.recent_events.slice(0, 20).map((event, index) => (
                      <button
                        key={event.id}
                        onClick={() => handleEventClick(event.id)}
                        aria-label={`View event #${Math.max(1, issue.count - index)}, ${formatRelativeTime(event.timestamp)}${event.release ? `, release ${event.release}` : ""}`}
                        className="w-full flex items-center justify-between rounded-md border p-2 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground">
                            #{Math.max(1, issue.count - index)}
                          </span>
                          <span className="text-sm">{formatRelativeTime(event.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {event.release && <span className="bg-muted px-1.5 py-0.5 rounded">{event.release}</span>}
                          <ChevronRight className="h-3 w-3" />
                        </div>
                      </button>
                    ))}
                    {issue.recent_events.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        Showing 20 of {issue.recent_events.length} events
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Context Tab */}
          {activeTab === "context" && (
            <div id="tabpanel-context" role="tabpanel" aria-labelledby="tab-context" tabIndex={0} className="space-y-4">
              {/* Request */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4" aria-hidden="true" />
                      Request
                    </CardTitle>
                    {issue.request?.url && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyCurl}>
                        <Terminal className="mr-1 h-3 w-3" />
                        cURL
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!issue.request ? (
                    <p className="text-sm text-muted-foreground">No request context</p>
                  ) : (
                    <div className="space-y-3">
                      {(issue.request.url || issue.request.method) && (
                        <div className="flex items-center gap-2 text-sm">
                          {issue.request.method && (
                            <span className="rounded bg-accent-2/15 px-1.5 py-0.5 text-xs font-medium text-accent-2">
                              {issue.request.method}
                            </span>
                          )}
                          <span className="font-mono text-xs break-all">{issue.request.url || "(no URL)"}</span>
                        </div>
                      )}
                      {issue.request.headers && Object.keys(issue.request.headers).length > 0 && (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Headers ({Object.keys(issue.request.headers).length})
                          </summary>
                          <div className="mt-2 rounded border divide-y text-xs">
                            {Object.entries(issue.request.headers).map(([key, val]) => (
                              <div key={key} className="flex justify-between p-2">
                                <span className="text-muted-foreground">{key}</span>
                                <span className="font-mono truncate max-w-xs">{val}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {issue.request.query_string && (
                        <details className="group" open>
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Query Parameters
                          </summary>
                          <div className="mt-2 rounded border divide-y text-xs">
                            {issue.request.query_string.split("&").filter(Boolean).map((pair, idx) => {
                              const eqIdx = pair.indexOf("=");
                              const key = eqIdx >= 0 ? decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, " ")) : pair;
                              const val = eqIdx >= 0 ? decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " ")) : "";
                              return (
                                <div key={idx} className="flex justify-between p-2">
                                  <span className="text-muted-foreground">{key}</span>
                                  <span className="font-mono truncate max-w-xs">{val || <em className="opacity-50">empty</em>}</span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                      {issue.request.data != null && (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Request Body
                          </summary>
                          <pre className="mt-2 bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono max-h-48">
                            {typeof issue.request.data === "string"
                              ? issue.request.data
                              : JSON.stringify(issue.request.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              {/* User */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" aria-hidden="true" />
                    User
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!issue.user ? (
                    <p className="text-sm text-muted-foreground">No user context</p>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {issue.user.id && (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs">ID:</span>
                            <span className="ml-2 font-mono">{issue.user.id}</span>
                          </div>
                        )}
                        {issue.user.email && (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs">Email:</span>
                            <span className="ml-2 font-mono">{issue.user.email}</span>
                          </div>
                        )}
                        {issue.user.username && (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs">Username:</span>
                            <span className="ml-2 font-mono">{issue.user.username}</span>
                          </div>
                        )}
                        {issue.user.ip_address && (
                          <div className="text-sm">
                            <span className="text-muted-foreground text-xs">IP:</span>
                            <span className="ml-2 font-mono">{issue.user.ip_address}</span>
                          </div>
                        )}
                      </div>
                      {issue.user.extra && Object.keys(issue.user.extra).length > 0 && (
                        <details className="mt-3 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Additional Attributes ({Object.keys(issue.user.extra).length})
                          </summary>
                          <div className="mt-2 rounded border divide-y text-xs">
                            {Object.entries(issue.user.extra).map(([key, val]) => (
                              <div key={key} className="flex justify-between p-2">
                                <span className="text-muted-foreground">{key}</span>
                                <span className="font-mono truncate max-w-xs">
                                  {typeof val === "string" ? val : JSON.stringify(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
              {/* Extra */}
              {issue.extra && Object.keys(issue.extra).length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Code className="h-4 w-4" aria-hidden="true" />
                      Extra Data
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono">
                      {JSON.stringify(issue.extra, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Sidebar ── */}
        <div className="space-y-4">
          {/* Stats */}
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Events</dt>
              <div className="flex items-center gap-2 mt-1">
                <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dd className="font-display text-2xl font-semibold tabular-nums">{issue.count}</dd>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Users</dt>
              <div className="flex items-center gap-2 mt-1">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dd className="font-display text-2xl font-semibold tabular-nums">{issue.user_count}</dd>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">First seen</dt>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dd>
                  <time dateTime={issue.first_seen} className="text-sm font-medium">
                    {formatRelativeTime(issue.first_seen)}
                  </time>
                </dd>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Last seen</dt>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dd>
                  <time dateTime={issue.last_seen} className="text-sm font-medium">
                    {formatRelativeTime(issue.last_seen)}
                  </time>
                </dd>
              </div>
            </div>
            {issue.environment && (
              <div className="col-span-2 rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground mb-1">Environment</dt>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <dd>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        (ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.bg
                      } ${(ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.text}`}
                    >
                      {issue.environment}
                    </span>
                  </dd>
                </div>
              </div>
            )}
          </dl>

          {/* Frequency Chart */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Frequency</CardTitle>
                <div className="flex gap-0.5" role="group" aria-label="Frequency period">
                  {(["24h", "7d", "30d"] as const).map((period) => (
                    <Button
                      key={period}
                      variant={frequencyPeriod === period ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setFrequencyPeriod(period)}
                      aria-pressed={frequencyPeriod === period}
                      className="h-6 px-2 text-[10px]"
                    >
                      {period}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {frequencyLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : frequencyData && frequencyData.total > 0 ? (
                <div>
                  <div
                    className="h-24 flex items-end gap-0.5"
                    role="img"
                    aria-label={`Frequency chart: ${frequencyData.total} events in the last ${frequencyPeriod}`}
                  >
                    {(() => {
                      return chartBuckets.map((b, i) => (
                        <div
                          key={i}
                          className="flex-1 group relative"
                          aria-label={`${b.count} event${b.count !== 1 ? "s" : ""}`}
                        >
                          <div
                            className={`w-full rounded-t transition-colors ${b.count > 0 ? "bg-blue-600 hover:bg-blue-500" : "bg-muted"}`}
                            style={{
                              height: `${Math.max((b.count / chartMax) * 100, b.count > 0 ? 15 : 3)}%`,
                              minHeight: b.count > 0 ? "4px" : "2px",
                            }}
                          />
                          <div
                            className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded border shadow-sm whitespace-nowrap z-10"
                            aria-hidden="true"
                          >
                            {b.count}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {frequencyData.total} events in {frequencyPeriod}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-6">No data</p>
              )}
            </CardContent>
          </Card>

          {/* Impact */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Impact
                </CardTitle>
                {impactData?.is_trending && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-full text-[10px] font-medium">
                    <Flame className="h-3 w-3" aria-hidden="true" />
                    Trending
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {impactLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : impactData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <p className="text-base font-semibold">{impactData.unique_users}</p>
                        <p className="text-[10px] text-muted-foreground">users</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <p className="text-base font-semibold">{impactData.unique_sessions}</p>
                        <p className="text-[10px] text-muted-foreground">sessions</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <p className="text-base font-semibold">{impactData.last_hour_count}</p>
                        <p className="text-[10px] text-muted-foreground">last hour</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {impactData.trend_percent >= 0 ? (
                        <TrendingUp className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
                      )}
                      <div>
                        <p
                          className={`text-base font-semibold ${impactData.trend_percent > 0 ? "text-red-600" : impactData.trend_percent < 0 ? "text-green-600" : ""}`}
                        >
                          {impactData.trend_percent > 0 ? "+" : ""}
                          {impactData.trend_percent}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">trend</p>
                      </div>
                    </div>
                  </div>
                  {impactData.browsers.length > 0 && (
                    <DistributionBars label="Browsers" items={impactData.browsers} />
                  )}
                  {impactData.operating_systems.length > 0 && (
                    <DistributionBars label="OS" items={impactData.operating_systems} />
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No data</p>
              )}
            </CardContent>
          </Card>

          {/* Tags */}
          {issue.tags && Object.keys(issue.tags).length > 0 && (
            <Card>
              <CardHeader className="pb-2 px-4 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(issue.tags).map(([key, value]) => (
                    <div key={key} className="rounded-md border px-2 py-1 text-[11px]">
                      <span className="text-muted-foreground">{key}:</span>
                      <span className="ml-1 font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Session Replay */}
          {hasReplay && issueReplay && (
            <Card>
              <CardHeader className="pb-2 px-4 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Video className="h-3.5 w-3.5" aria-hidden="true" />
                  Session Replay
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xs space-y-1">
                  <p>A session replay is available for this issue.</p>
                  <p className="text-muted-foreground">
                    Session: <span className="font-mono">{issueReplay.session_id}</span>
                    {issueReplay.duration_ms && ` (${Math.round(issueReplay.duration_ms / 1000)}s)`}
                  </p>
                  <Link
                    href={`/dashboard/replay?project=${projectId}`}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1"
                  >
                    <Video className="h-3 w-3" aria-hidden="true" />
                    Watch replay
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Linked Issues */}
          {hasIntegrations && (
            <LinkedIssues
              projectId={projectId || ""}
              issueId={issueId}
              links={linkedIssues}
              onLinksChange={setLinkedIssues}
            />
          )}

          {/* Discussion */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Discussion
                {comments.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({comments.length})</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex gap-2 mb-3">
                <textarea
                  ref={commentRef}
                  value={newComment}
                  onChange={handleTextareaChange}
                  aria-label="Add a comment"
                  placeholder="Add a comment..."
                  rows={1}
                  className="flex-1 min-h-[32px] max-h-[120px] rounded-md border bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSubmitComment();
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={handleSubmitComment}
                  disabled={submittingComment || !newComment.trim()}
                  aria-label={submittingComment ? "Submitting comment" : "Submit comment"}
                >
                  {submittingComment ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2" aria-hidden="true">
                <kbd className="font-mono">{isMac ? "⌘" : "Ctrl"}</kbd>+<kbd className="font-mono">Enter</kbd> to submit
              </p>

              {commentsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No comments yet</p>
              ) : (
                <div id="comment-list" className="space-y-2">
                  {(showAllComments ? comments : comments.slice(0, 3)).map((comment) => (
                    <div key={comment.id} className="group flex items-start gap-2 text-sm">
                      <div className="h-6 w-6 rounded-full bg-accent-2/15 text-accent-2 flex items-center justify-center text-xs font-medium shrink-0">
                        {(comment.user_name ?? comment.user_email ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingCommentId === comment.id ? (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              aria-label="Edit comment"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="flex-1 h-6 rounded border bg-background px-2 text-xs"
                            />
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleUpdateComment(comment.id)}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1 text-xs"
                              onClick={() => setEditingCommentId(null)}
                              aria-label="Cancel edit"
                            >
                              <XCircle className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-xs">
                                {comment.user_name || comment.user_email?.split("@")[0] || "User"}
                              </span>
                              <time dateTime={comment.created_at} className="text-xs text-muted-foreground">
                                · {formatRelativeTime(comment.created_at)}
                              </time>
                              <div className="ml-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 focus:opacity-100"
                                  aria-label="Edit comment"
                                  onClick={() => {
                                    setEditingCommentId(comment.id);
                                    setEditingContent(comment.content);
                                  }}
                                >
                                  <Edit3 className="h-3 w-3" aria-hidden="true" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-destructive focus:opacity-100"
                                  aria-label="Delete comment"
                                  onClick={() => handleDeleteComment(comment.id)}
                                >
                                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{comment.content}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {comments.length > 3 && (
                    <button
                      onClick={() => setShowAllComments((v) => !v)}
                      aria-expanded={showAllComments}
                      aria-controls="comment-list"
                      className="text-xs text-accent-2 hover:underline w-full text-center pt-1"
                    >
                      {showAllComments ? "Show fewer comments" : `View all ${comments.length} comments`}
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Event Inspector Modal */}
      <Dialog
        open={!!selectedEventId}
        onOpenChange={(open) => {
          if (!open) closeEventModal();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="border-b p-4 shrink-0">
            <DialogTitle className="font-display text-heading-sm">Event Inspector</DialogTitle>
            {eventDetail && (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-sm text-muted-foreground">
                  {new Date(eventDetail.timestamp).toLocaleString()}
                </span>
                {eventDetail.release && (
                  <span className="rounded-full bg-accent-2/10 text-accent-2 px-2 py-0.5 text-[10px] font-medium font-mono">
                    {eventDetail.release}
                  </span>
                )}
                {eventDetail.environment && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                    {eventDetail.environment}
                  </span>
                )}
                {eventDetail.server_name && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    {eventDetail.server_name}
                  </span>
                )}
              </div>
            )}
          </DialogHeader>
          {eventDetail && !eventLoading && (() => {
            const visibleModalTabs = (
              [
                { id: "exception", label: "Stack Trace", show: !!eventDetail.exception },
                { id: "request", label: "Request", show: !!eventDetail.request },
                { id: "breadcrumbs", label: `Breadcrumbs (${eventDetail.breadcrumbs?.length ?? 0})`, show: true },
                { id: "meta", label: "Tags & Extra", show: Object.keys(eventDetail.tags ?? {}).length > 0 || !!eventDetail.extra },
              ] as const
            ).filter((t) => t.show);
            return (
              <div
                className="flex border-b shrink-0"
                role="tablist"
                aria-label="Event sections"
                onKeyDown={(e) => {
                  const currentIdx = visibleModalTabs.findIndex((t) => t.id === eventModalTab);
                  if (e.key === "ArrowRight") {
                    const next = visibleModalTabs[(currentIdx + 1) % visibleModalTabs.length];
                    if (next) {
                      setEventModalTab(next.id);
                      document.getElementById(`modal-tab-${next.id}`)?.focus();
                    }
                  } else if (e.key === "ArrowLeft") {
                    const prev = visibleModalTabs[(currentIdx - 1 + visibleModalTabs.length) % visibleModalTabs.length];
                    if (prev) {
                      setEventModalTab(prev.id);
                      document.getElementById(`modal-tab-${prev.id}`)?.focus();
                    }
                  }
                }}
              >
                {visibleModalTabs.map((t) => (
                  <button
                    key={t.id}
                    id={`modal-tab-${t.id}`}
                    role="tab"
                    aria-selected={eventModalTab === t.id}
                    aria-controls={`modal-tabpanel-${t.id}`}
                    tabIndex={eventModalTab === t.id ? 0 : -1}
                    onClick={() => setEventModalTab(t.id)}
                    className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                      eventModalTab === t.id
                        ? "border-accent-2 text-accent-2"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="flex-1 overflow-y-auto p-4">
            {eventLoading && (
              <div className="flex flex-col items-center py-12" role="status" aria-label="Loading event details">
                <Loader2 className="h-8 w-8 animate-spin text-accent-2" aria-hidden="true" />
                <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
              </div>
            )}
            {eventDetail && !eventLoading && (
              <>
                {eventModalTab === "exception" && eventDetail.exception && (
                  <div
                    id="modal-tabpanel-exception"
                    role="tabpanel"
                    aria-labelledby="modal-tab-exception"
                    className="space-y-3"
                  >
                    <div className="rounded-md border p-3 bg-destructive/5">
                      <p className="font-mono text-sm text-destructive font-medium">
                        {eventDetail.exception.type}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground mt-1">
                        {eventDetail.exception.value}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {eventDetail.exception.stacktrace.map((frame, i) => (
                        <StackFrame
                          key={i}
                          frame={frame}
                          index={i}
                          isExpanded={modalExpandedFrames.has(i)}
                          onToggle={() => setModalExpandedFrames(prev => {
                            const next = new Set(prev);
                            if (next.has(i)) {
                              next.delete(i);
                            } else {
                              next.add(i);
                            }
                            return next;
                          })}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {eventModalTab === "request" && (
                  <div id="modal-tabpanel-request" role="tabpanel" aria-labelledby="modal-tab-request" className="space-y-3">
                    {!eventDetail.request ? (
                      <p className="text-sm text-muted-foreground py-4">No request context for this event.</p>
                    ) : (
                      <>
                        {(eventDetail.request.url || eventDetail.request.method) && (
                          <div className="flex items-center gap-2 text-sm">
                            {eventDetail.request.method && (
                              <span className="rounded bg-accent-2/15 px-1.5 py-0.5 text-xs font-medium text-accent-2">
                                {eventDetail.request.method}
                              </span>
                            )}
                            <span className="font-mono text-xs break-all">{eventDetail.request.url}</span>
                          </div>
                        )}
                        {eventDetail.request.query_string && (
                          <details open>
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Query Parameters
                            </summary>
                            <div className="mt-2 rounded border divide-y text-xs">
                              {eventDetail.request.query_string.split("&").filter(Boolean).map((pair, idx) => {
                                const eqIdx = pair.indexOf("=");
                                const key = eqIdx >= 0 ? decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, " ")) : pair;
                                const val = eqIdx >= 0 ? decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " ")) : "";
                                return (
                                  <div key={idx} className="flex justify-between p-2">
                                    <span className="text-muted-foreground">{key}</span>
                                    <span className="font-mono">{val}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )}
                        {eventDetail.request.headers && Object.keys(eventDetail.request.headers).length > 0 && (
                          <details>
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Headers ({Object.keys(eventDetail.request.headers).length})
                            </summary>
                            <div className="mt-2 rounded border divide-y text-xs">
                              {Object.entries(eventDetail.request.headers).map(([k, v]) => (
                                <div key={k} className="flex justify-between p-2">
                                  <span className="text-muted-foreground">{k}</span>
                                  <span className="font-mono truncate max-w-xs">{v}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {eventDetail.request.data != null && (
                          <details>
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Request Body
                            </summary>
                            <pre className="mt-2 bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono max-h-48">
                              {typeof eventDetail.request.data === "string"
                                ? eventDetail.request.data
                                : JSON.stringify(eventDetail.request.data, null, 2)}
                            </pre>
                          </details>
                        )}
                        {eventDetail.user && (
                          <div className="rounded-md border p-3 space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">User</p>
                            {eventDetail.user.id && <div className="text-xs"><span className="text-muted-foreground">ID: </span><span className="font-mono">{eventDetail.user.id}</span></div>}
                            {eventDetail.user.email && <div className="text-xs"><span className="text-muted-foreground">Email: </span><span className="font-mono">{eventDetail.user.email}</span></div>}
                            {eventDetail.user.username && <div className="text-xs"><span className="text-muted-foreground">Username: </span><span className="font-mono">{eventDetail.user.username}</span></div>}
                            {eventDetail.user.ip_address && <div className="text-xs"><span className="text-muted-foreground">IP: </span><span className="font-mono">{eventDetail.user.ip_address}</span></div>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {eventModalTab === "breadcrumbs" && (
                  <div id="modal-tabpanel-breadcrumbs" role="tabpanel" aria-labelledby="modal-tab-breadcrumbs">
                    {!eventDetail.breadcrumbs || eventDetail.breadcrumbs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No breadcrumbs for this event.</p>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />
                        <div className="space-y-2">
                          {eventDetail.breadcrumbs.map((crumb, index) => {
                            const isError = crumb.level === "error";
                            const CrumbIcon = getBreadcrumbIcon(crumb.type, crumb.category);
                            const dotColor = isError
                              ? "bg-red-500"
                              : crumb.type === "http" || crumb.category === "xhr"
                                ? "bg-blue-500"
                                : crumb.type === "navigation"
                                  ? "bg-green-500"
                                  : "bg-gray-400";
                            return (
                              <div key={index} className="relative flex items-start gap-3 pl-8">
                                <div
                                  aria-hidden="true"
                                  className={`absolute left-1.5 top-2 h-3 w-3 rounded-full ${dotColor} ring-2 ring-background flex items-center justify-center`}
                                >
                                  <CrumbIcon className="h-1.5 w-1.5 text-white" />
                                </div>
                                <div className={`flex-1 rounded-md border p-2 text-sm ${isError ? "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20" : "bg-muted/30"}`}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {new Date(crumb.timestamp).toLocaleTimeString()}
                                    </span>
                                    <span className={`text-xs px-1 py-0.5 rounded ${isError ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted"}`}>
                                      {crumb.category || crumb.type}
                                    </span>
                                  </div>
                                  <p className={`text-xs mt-1 ${isError ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
                                    {crumb.message || "(no message)"}
                                  </p>
                                  {crumb.data && Object.keys(crumb.data).length > 0 && (
                                    <BreadcrumbData type={crumb.type} category={crumb.category} data={crumb.data} />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {eventModalTab === "meta" && (
                  <div id="modal-tabpanel-meta" role="tabpanel" aria-labelledby="modal-tab-meta" className="space-y-4">
                    {eventDetail.tags && Object.keys(eventDetail.tags).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(eventDetail.tags).map(([key, value]) => (
                            <div key={key} className="rounded-md border px-2 py-1 text-[11px]">
                              <span className="text-muted-foreground">{key}:</span>{" "}
                              <span className="font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {eventDetail.extra && Object.keys(eventDetail.extra).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Extra</p>
                        <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono">
                          {JSON.stringify(eventDetail.extra, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex justify-end border-t p-4 shrink-0">
            <Button variant="outline" onClick={closeEventModal}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create External Issue Dialog */}
      {hasIntegrations && projectId && (
        <CreateIssueDialog
          open={createIssueOpen}
          onOpenChange={setCreateIssueOpen}
          projectId={projectId}
          issueId={issueId}
          issueTitle={issue?.title || ""}
          onCreated={(link) => setLinkedIssues((prev) => [link, ...prev])}
        />
      )}
    </div>
  );
}

export default function IssueDetailPage() {
  return (
    <Suspense>
      <IssueDetailPageContent />
    </Suspense>
  );
}
