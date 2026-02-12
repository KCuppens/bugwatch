"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  Tag,
  ChevronRight,
  Sparkles,
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
} from "lucide-react";
import { issuesApi, aiFixApi, type IssueDetail, type AiFix, type BreadcrumbDetail, type EventDetail, type FrequencyData, type ImpactData, type IssueComment } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTier } from "@/hooks/use-feature";
import { Badge } from "@/components/ui/badge";
import { StackFrame } from "@/components/issue-detail/StackFrame";
import { IssueNavigation } from "@/components/issue-detail/IssueNavigation";
import { IssueDetailSkeleton } from "@/components/skeletons/issue-detail-skeleton";
import { toast } from "sonner";

// Mock data fallback
const mockIssue: IssueDetail = {
  id: "1", project_id: "1", fingerprint: "abc123def456",
  title: "TypeError: Cannot read property 'map' of undefined",
  level: "error", status: "unresolved", count: 142, user_count: 23,
  first_seen: "2024-01-12T10:30:00Z", last_seen: "2024-01-15T14:22:00Z",
  exception: {
    type: "TypeError", value: "Cannot read property 'map' of undefined",
    stacktrace: [
      { filename: "src/components/UserList.tsx", function: "UserList", lineno: 45, colno: 23,
        context_line: "    return users.map((user) => (",
        pre_context: ["  const { users } = props;", "", "  // Render the list of users"],
        post_context: ["      <UserCard key={user.id} user={user} />", "    ));", "  };"],
        in_app: true },
      { filename: "src/pages/dashboard.tsx", function: "Dashboard", lineno: 78, colno: 12,
        context_line: "      <UserList users={data?.users} />",
        pre_context: ["    return (", '      <div className="container">'],
        post_context: ["      </div>", "    );"],
        in_app: true },
      { filename: "node_modules/react-dom/cjs/react-dom.development.js", function: "renderWithHooks",
        lineno: 14985, colno: 18, in_app: false },
    ],
  },
  recent_events: [
    { id: "evt1", timestamp: "2024-01-15T14:22:00Z", user_id: "usr_abc123", release: "v1.2.3" },
    { id: "evt2", timestamp: "2024-01-15T14:07:00Z", user_id: "usr_def456", release: "v1.2.3" },
    { id: "evt3", timestamp: "2024-01-15T13:52:00Z", release: "v1.2.3" },
  ],
  tags: { browser: "Chrome 120", os: "macOS 14.2", url: "/dashboard", user_id: "usr_abc123" },
  breadcrumbs: [
    { timestamp: "2024-01-15T14:22:01Z", type: "navigation", category: "navigation", message: "Navigated to /dashboard", level: "info" },
    { timestamp: "2024-01-15T14:22:02Z", type: "http", category: "xhr", message: "GET /api/users - 200", level: "info" },
    { timestamp: "2024-01-15T14:22:03Z", type: "console", category: "console", message: "Data loaded successfully", level: "info" },
    { timestamp: "2024-01-15T14:22:03Z", type: "error", category: "error", message: "TypeError: Cannot read property 'map' of undefined", level: "error" },
  ],
  request: { url: "http://localhost:3000/dashboard", method: "GET",
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
    query_string: "tab=overview" },
  user: { id: "usr_abc123", email: "john@example.com", username: "johndoe", ip_address: "192.168.1.100" },
  extra: { component: "UserList", render_count: 3, last_action: "refresh_data" },
};

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

export default function IssueDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const issueId = params.id as string;
  const projectId = searchParams.get("project");

  const { user } = useAuth();
  const { isPro } = useTier();
  const userCredits = user?.credits ?? 0;

  // Core state
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"debug" | "timeline" | "context">("debug");
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set([0]));
  const [isResolving, setIsResolving] = useState(false);
  const [isIgnoring, setIsIgnoring] = useState(false);

  // AI Fix state (inline, not modal)
  const [showAiFix, setShowAiFix] = useState(false);
  const [aiFix, setAiFix] = useState<AiFix | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixError, setAiFixError] = useState<string | null>(null);
  const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);

  // Event inspector
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(false);

  // Frequency chart
  const [frequencyData, setFrequencyData] = useState<FrequencyData | null>(null);
  const [frequencyPeriod, setFrequencyPeriod] = useState<"24h" | "7d" | "30d">("24h");
  const [frequencyLoading, setFrequencyLoading] = useState(false);

  // Breadcrumb filter
  const [breadcrumbFilter, setBreadcrumbFilter] = useState<string>("all");

  // Impact
  const [impactData, setImpactData] = useState<ImpactData | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  // Comments
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [showAllComments, setShowAllComments] = useState(false);

  // Auto-resize textarea ref
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // Fetch issue
  useEffect(() => {
    async function fetchIssue() {
      if (!projectId) { setIssue(mockIssue); setIsLoading(false); return; }
      setIsLoading(true);
      setError(null);
      try {
        const response = await issuesApi.get(projectId, issueId);
        setIssue(response.data);
      } catch (err) {
        toast.error("Failed to load issue details");
        setIssue(mockIssue);
        setError(null);
      } finally {
        setIsLoading(false);
      }
    }
    fetchIssue();
  }, [issueId, projectId]);

  // Auto-expand in-app frames
  useEffect(() => {
    if (issue?.exception?.stacktrace) {
      const inAppIndices = issue.exception.stacktrace
        .map((f, i) => (f.in_app ? i : -1))
        .filter((i) => i !== -1);
      setExpandedFrames(new Set(inAppIndices.length > 0 ? inAppIndices : [0]));
    }
  }, [issue]);

  // Fetch frequency data
  useEffect(() => {
    async function fetchFrequency() {
      if (!projectId) return;
      setFrequencyLoading(true);
      try {
        const response = await issuesApi.getFrequency(projectId, issueId, frequencyPeriod);
        setFrequencyData(response.data);
      } catch { setFrequencyData(null); }
      finally { setFrequencyLoading(false); }
    }
    if (issue) fetchFrequency();
  }, [issueId, projectId, frequencyPeriod, issue]);

  // Fetch impact
  useEffect(() => {
    async function fetchImpact() {
      if (!projectId) return;
      setImpactLoading(true);
      try {
        const response = await issuesApi.getImpact(projectId, issueId);
        setImpactData(response.data);
      } catch { setImpactData(null); }
      finally { setImpactLoading(false); }
    }
    if (issue) fetchImpact();
  }, [issueId, projectId, issue]);

  // Fetch comments
  useEffect(() => {
    async function fetchComments() {
      if (!projectId) return;
      setCommentsLoading(true);
      try {
        const response = await issuesApi.listComments(projectId, issueId);
        setComments(response.data);
      } catch { setComments([]); }
      finally { setCommentsLoading(false); }
    }
    if (issue) fetchComments();
  }, [issueId, projectId, issue]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "r":
          if (issue?.status !== "resolved" && !isResolving) { e.preventDefault(); handleResolve(); }
          break;
        case "i":
          if (issue?.status !== "ignored" && !isIgnoring) { e.preventDefault(); handleIgnore(); }
          break;
        case "c":
          e.preventDefault(); handleCopyForAi();
          break;
        case "a":
          if (!aiFixLoading) { e.preventDefault(); handleGenerateAiFix(); }
          break;
        case "escape":
          if (showAiFix) setShowAiFix(false);
          else if (selectedEventId) closeEventModal();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [issue, isResolving, isIgnoring, aiFixLoading, showAiFix, selectedEventId]);

  function toggleFrame(index: number) {
    const newExpanded = new Set(expandedFrames);
    if (newExpanded.has(index)) newExpanded.delete(index);
    else newExpanded.add(index);
    setExpandedFrames(newExpanded);
  }

  // Resolve with undo toast
  async function handleResolve() {
    if (!issue || !projectId) return;
    const prev = issue.status;
    setIsResolving(true);
    setIssue({ ...issue, status: "resolved" });

    toast.success("Issue resolved", {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssue((i) => i ? { ...i, status: prev } : i);
          try { await issuesApi.update(projectId, issueId, prev); } catch { toast.error("Failed to undo"); }
        },
      },
    });

    try {
      await issuesApi.update(projectId, issueId, "resolved");
    } catch {
      setIssue((i) => i ? { ...i, status: prev } : i);
      toast.error("Failed to resolve issue");
    } finally { setIsResolving(false); }
  }

  async function handleIgnore() {
    if (!issue || !projectId) return;
    const prev = issue.status;
    setIsIgnoring(true);
    setIssue({ ...issue, status: "ignored" });

    toast.success("Issue ignored", {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssue((i) => i ? { ...i, status: prev } : i);
          try { await issuesApi.update(projectId, issueId, prev); } catch { toast.error("Failed to undo"); }
        },
      },
    });

    try {
      await issuesApi.update(projectId, issueId, "ignored");
    } catch {
      setIssue((i) => i ? { ...i, status: prev } : i);
      toast.error("Failed to ignore issue");
    } finally { setIsIgnoring(false); }
  }

  async function handleGenerateAiFix() {
    if (!issue) return;
    setShowAiFix(true);
    setAiFixLoading(true);
    setAiFixError(null);

    try {
      const request = {
        error_type: issue.exception?.type || "Error",
        error_message: issue.exception?.value || issue.title,
        stack_trace: (issue.exception?.stacktrace || []).map((f) => ({
          filename: f.filename, function: f.function, lineno: f.lineno, colno: f.colno,
          context_line: f.context_line, pre_context: f.pre_context, post_context: f.post_context, in_app: f.in_app,
        })),
      };
      const response = projectId
        ? await aiFixApi.generateFix(projectId, issueId, request)
        : await aiFixApi.generateFixStandalone(request);
      setAiFix(response.fix);
      setAiCreditsRemaining(response.credits_remaining);
    } catch (err) {
      setAiFixError(err instanceof Error ? err.message : "Failed to generate AI fix");
      toast.error("Failed to generate AI fix");
    } finally { setAiFixLoading(false); }
  }

  function handleCopyFix() {
    if (!aiFix) return;
    navigator.clipboard.writeText(aiFix.fix_code);
    toast.success("Fix code copied");
  }

  function handleCopyForAi() {
    if (!issue) return;
    const lines: string[] = ["# Error Report", "",
      `**Error Type:** ${issue.exception?.type || "Unknown"}`,
      `**Message:** ${issue.exception?.value || issue.title}`,
      `**Level:** ${issue.level}`, `**Occurrences:** ${issue.count} events`, ""];
    if (issue.exception?.stacktrace?.length) {
      lines.push("## Stack Trace", "```");
      issue.exception.stacktrace.slice(0, 5).forEach((f) => {
        lines.push(`${f.function || "(anonymous)"} at ${f.filename}:${f.lineno}${f.in_app ? " [in-app]" : ""}`);
        if (f.context_line) lines.push(`  > ${f.context_line.trim()}`);
      });
      lines.push("```", "");
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied for AI assistant");
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied");
  }

  function handleCopyCurl() {
    if (!issue?.request) return;
    const parts: string[] = ["curl"];
    const method = issue.request.method || "GET";
    if (method !== "GET") parts.push(`-X ${method}`);
    let url = issue.request.url || "";
    if (issue.request.query_string && !url.includes("?")) url += `?${issue.request.query_string}`;
    const sensitive = ["authorization", "cookie", "x-api-key"];
    if (issue.request.headers) {
      Object.entries(issue.request.headers).forEach(([key, value]) => {
        parts.push(sensitive.includes(key.toLowerCase()) ? `-H "${key}: [REDACTED]"` : `-H "${key}: ${value}"`);
      });
    }
    parts.push(`"${url}"`);
    navigator.clipboard.writeText(parts.join(" \\\n  "));
    toast.success("cURL command copied");
  }

  async function handleEventClick(eventId: string) {
    if (!projectId) return;
    setSelectedEventId(eventId);
    setEventLoading(true);
    setEventDetail(null);
    try {
      const response = await issuesApi.getEvent(projectId, issueId, eventId);
      setEventDetail(response.data);
    } catch {
      toast.error("Failed to load event details");
    } finally { setEventLoading(false); }
  }

  function closeEventModal() { setSelectedEventId(null); setEventDetail(null); }

  async function handleSubmitComment() {
    if (!projectId || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const response = await issuesApi.createComment(projectId, issueId, newComment.trim());
      setComments([response.data, ...comments]);
      setNewComment("");
      if (commentRef.current) commentRef.current.style.height = "auto";
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally { setSubmittingComment(false); }
  }

  async function handleUpdateComment(commentId: string) {
    if (!projectId || !editingContent.trim()) return;
    try {
      const response = await issuesApi.updateComment(projectId, issueId, commentId, editingContent.trim());
      setComments(comments.map(c => c.id === commentId ? response.data : c));
      setEditingCommentId(null);
      setEditingContent("");
      toast.success("Comment updated");
    } catch { toast.error("Failed to update comment"); }
  }

  async function handleDeleteComment(commentId: string) {
    if (!projectId) return;
    try {
      await issuesApi.deleteComment(projectId, issueId, commentId);
      setComments(comments.filter(c => c.id !== commentId));
      toast.success("Comment deleted");
    } catch { toast.error("Failed to delete comment"); }
  }

  // Auto-resize textarea
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewComment(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  if (isLoading) return <IssueDetailSkeleton />;

  if (error || !issue) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4 animate-fade-in-up">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-medium">Failed to load issue</h2>
        <p className="text-muted-foreground">{error || "Issue not found"}</p>
        <Link href="/dashboard"><Button>Back to Dashboard</Button></Link>
      </div>
    );
  }

  const stacktrace = issue.exception?.stacktrace || [];
  const firstInAppIndex = stacktrace.findIndex(f => f.in_app);
  const aiFixInsertIndex = firstInAppIndex >= 0 ? firstInAppIndex : 0;

  return (
    <div className="space-y-4">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className={`shrink-0 rounded-md p-1.5 ${
              issue.level === "fatal" ? "bg-red-100 dark:bg-red-950" :
              issue.level === "error" ? "bg-orange-100 dark:bg-orange-950" :
              issue.level === "warning" ? "bg-yellow-100 dark:bg-yellow-950" :
              "bg-blue-100 dark:bg-blue-950"
            }`}>
              <AlertCircle className={`h-4 w-4 ${
                issue.level === "fatal" ? "text-red-600" :
                issue.level === "error" ? "text-orange-600" :
                issue.level === "warning" ? "text-yellow-600" : "text-blue-600"
              }`} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{issue.title}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{issue.count} events</span>
                <span>·</span>
                <span>{issue.user_count} users</span>
                {issue.status !== "unresolved" && (
                  <>
                    <span>·</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      issue.status === "resolved" ? "bg-bug text-bug-foreground" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}>
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
            <Button variant="outline" size="sm" onClick={handleResolve}
              disabled={isResolving || issue.status === "resolved"} className="h-8">
              {isResolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              <span className="ml-1.5 hidden sm:inline">{issue.status === "resolved" ? "Resolved" : "Resolve"}</span>
            </Button>
            <Button size="sm" onClick={handleGenerateAiFix}
              disabled={aiFixLoading || (!isPro && userCredits === 0)} className="h-8">
              {aiFixLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              <span className="ml-1.5 hidden sm:inline">AI Fix</span>
              {userCredits > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{userCredits}</Badge>}
            </Button>
          </div>
        </div>
      </div>

      {/* Action Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleIgnore}
          disabled={isIgnoring || issue.status === "ignored"} className="h-7 text-xs">
          {isIgnoring ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <XCircle className="mr-1.5 h-3 w-3" />}
          {issue.status === "ignored" ? "Ignored" : "Ignore"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-7 text-xs">
          <LinkIcon className="mr-1.5 h-3 w-3" />Copy Link
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyForAi} className="h-7 text-xs">
          <Clipboard className="mr-1.5 h-3 w-3" />Copy for AI
        </Button>
      </div>

      {/* ═══════ TWO-COLUMN LAYOUT ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

        {/* ── LEFT COLUMN: Tabs + Content ── */}
        <div className="space-y-4 min-w-0">
          {/* Tabs */}
          <div className="border-b">
            <div className="flex gap-1">
              {([
                { id: "debug" as const, label: "Stack Trace", icon: Code },
                { id: "timeline" as const, label: "Timeline", icon: Clock },
                { id: "context" as const, label: "Context", icon: Globe },
              ]).map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    }`}>
                    <TabIcon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Debug Tab - Stack Trace */}
          {activeTab === "debug" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-sm">{issue.exception?.type}: {issue.exception?.value}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{stacktrace.length} frames, {stacktrace.filter(f => f.in_app).length} in-app</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => { navigator.clipboard.writeText(stacktrace.map(f => `  at ${f.function} (${f.filename}:${f.lineno})`).join("\n")); toast.success("Stack trace copied"); }}>
                  <Copy className="mr-1.5 h-3 w-3" />Copy
                </Button>
              </div>

              {stacktrace.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No stack trace available</p>
              ) : (
                stacktrace.map((frame, index) => (
                  <div key={index}>
                    <StackFrame frame={frame} index={index} isExpanded={expandedFrames.has(index)} onToggle={() => toggleFrame(index)} />
                    {/* Inline AI Fix - show below first in-app frame */}
                    {showAiFix && index === aiFixInsertIndex && (
                      <div className="ml-4 mt-2 mb-2 rounded-lg border border-primary/20 bg-primary/5 p-4 animate-fade-in-up">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="font-semibold text-sm">AI Fix</span>
                            {aiFix && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                aiFix.confidence >= 0.8 ? "bg-green-500/10 text-green-600" :
                                aiFix.confidence >= 0.5 ? "bg-yellow-500/10 text-yellow-600" :
                                "bg-red-500/10 text-red-600"
                              }`}>
                                {Math.round(aiFix.confidence * 100)}% confidence
                              </span>
                            )}
                            {aiCreditsRemaining !== null && (
                              <span className="text-xs text-muted-foreground">({aiCreditsRemaining} credits left)</span>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowAiFix(false)}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>

                        {aiFixLoading && (
                          <div className="flex items-center gap-3 py-6 justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Analyzing error...</p>
                          </div>
                        )}
                        {aiFixError && (
                          <div className="text-center py-4">
                            <p className="text-sm text-destructive">{aiFixError}</p>
                            <Button variant="outline" size="sm" className="mt-2" onClick={handleGenerateAiFix}>Try Again</Button>
                          </div>
                        )}
                        {aiFix && !aiFixLoading && (
                          <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">{aiFix.explanation}</p>
                            <div className="relative">
                              <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-md overflow-x-auto text-sm font-mono">{aiFix.fix_code}</pre>
                              <Button variant="secondary" size="sm" className="absolute top-2 right-2 h-7 text-xs" onClick={handleCopyFix}>
                                <Copy className="mr-1 h-3 w-3" />Copy
                              </Button>
                            </div>
                            {aiFix.recommendations.length > 0 && (
                              <ul className="space-y-1">
                                {aiFix.recommendations.map((rec, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <span className="text-primary mt-0.5 shrink-0">•</span>{rec}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === "timeline" && (
            <div className="space-y-4">
              {/* Breadcrumbs */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Breadcrumbs ({issue.breadcrumbs?.length || 0})</CardTitle>
                    {issue.breadcrumbs && issue.breadcrumbs.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <select value={breadcrumbFilter} onChange={(e) => setBreadcrumbFilter(e.target.value)}
                          className="h-7 rounded-md border bg-background px-2 text-xs">
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
                  {(!issue.breadcrumbs || issue.breadcrumbs.length === 0) ? (
                    <p className="text-center text-muted-foreground py-6 text-sm">No breadcrumbs captured</p>
                  ) : (() => {
                    const filtered = issue.breadcrumbs.filter((crumb) => {
                      if (breadcrumbFilter === "all") return true;
                      const cat = (crumb.category || crumb.type || "").toLowerCase();
                      if (breadcrumbFilter === "http") return ["http", "xhr", "fetch"].includes(cat);
                      if (breadcrumbFilter === "navigation") return cat === "navigation";
                      if (breadcrumbFilter === "console") return cat === "console";
                      if (breadcrumbFilter === "error") return crumb.level === "error";
                      return true;
                    });
                    if (filtered.length === 0) return <p className="text-center text-muted-foreground py-6 text-sm">No matching breadcrumbs</p>;

                    return (
                      <div className="relative">
                        <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />
                        <div className="space-y-2">
                          {filtered.map((crumb: BreadcrumbDetail, index: number) => {
                            const isError = crumb.level === "error";
                            const CrumbIcon = getBreadcrumbIcon(crumb.type, crumb.category);
                            const dotColor = isError ? "bg-red-500" :
                              crumb.type === "http" || crumb.category === "xhr" ? "bg-blue-500" :
                              crumb.type === "navigation" ? "bg-green-500" : "bg-gray-400";

                            // Time gap indicator
                            const prevCrumb = index > 0 ? filtered[index - 1] : null;
                            const gap = prevCrumb ? (new Date(crumb.timestamp).getTime() - new Date(prevCrumb.timestamp).getTime()) / 1000 : 0;

                            return (
                              <div key={index}>
                                {gap > 1 && (
                                  <div className="relative flex items-center pl-8 py-1">
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-b border-dashed border-muted flex-1">
                                      <span>+{gap < 60 ? `${gap.toFixed(1)}s` : `${Math.floor(gap / 60)}m ${Math.round(gap % 60)}s`}</span>
                                    </div>
                                  </div>
                                )}
                                <div className="relative flex items-start gap-3 pl-8">
                                  <div className={`absolute left-1.5 top-2 h-3 w-3 rounded-full ${dotColor} ring-2 ring-background flex items-center justify-center`}>
                                    <CrumbIcon className="h-1.5 w-1.5 text-white" />
                                  </div>
                                  <div className={`flex-1 rounded-md border p-2 text-sm ${isError ? "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20" : "bg-muted/30"}`}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground font-mono">{new Date(crumb.timestamp).toLocaleTimeString()}</span>
                                      <span className={`text-xs px-1 py-0.5 rounded ${isError ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted"}`}>
                                        {crumb.category || crumb.type}
                                      </span>
                                    </div>
                                    <p className={`text-xs mt-1 ${isError ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
                                      {crumb.message || "(no message)"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Events */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Recent Events ({issue.recent_events.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {issue.recent_events.map((event, index) => (
                      <button key={event.id} onClick={() => handleEventClick(event.id)}
                        className="w-full flex items-center justify-between rounded-md border p-2 hover:bg-muted/50 transition-colors text-left">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground">#{issue.count - index}</span>
                          <span className="text-sm">{formatRelativeTime(event.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {event.release && <span className="bg-muted px-1.5 py-0.5 rounded">{event.release}</span>}
                          <ChevronRight className="h-3 w-3" />
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Context Tab */}
          {activeTab === "context" && (
            <div className="space-y-4">
              {/* Request */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />Request</CardTitle>
                    {issue.request?.url && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyCurl}>
                        <Terminal className="mr-1 h-3 w-3" />cURL
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!issue.request ? <p className="text-sm text-muted-foreground">No request context</p> : (
                    <div className="space-y-3">
                      {(issue.request.url || issue.request.method) && (
                        <div className="flex items-center gap-2 text-sm">
                          {issue.request.method && <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs font-medium text-primary">{issue.request.method}</span>}
                          <span className="font-mono text-xs break-all">{issue.request.url || "(no URL)"}</span>
                        </div>
                      )}
                      {issue.request.headers && Object.keys(issue.request.headers).length > 0 && (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Headers ({Object.keys(issue.request.headers).length})</summary>
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
                    </div>
                  )}
                </CardContent>
              </Card>
              {/* User */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" />User</CardTitle></CardHeader>
                <CardContent>
                  {!issue.user ? <p className="text-sm text-muted-foreground">No user context</p> : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {issue.user.id && <div className="text-sm"><span className="text-muted-foreground text-xs">ID:</span><span className="ml-2 font-mono">{issue.user.id}</span></div>}
                      {issue.user.email && <div className="text-sm"><span className="text-muted-foreground text-xs">Email:</span><span className="ml-2 font-mono">{issue.user.email}</span></div>}
                      {issue.user.username && <div className="text-sm"><span className="text-muted-foreground text-xs">Username:</span><span className="ml-2 font-mono">{issue.user.username}</span></div>}
                      {issue.user.ip_address && <div className="text-sm"><span className="text-muted-foreground text-xs">IP:</span><span className="ml-2 font-mono">{issue.user.ip_address}</span></div>}
                    </div>
                  )}
                </CardContent>
              </Card>
              {/* Extra */}
              {issue.extra && Object.keys(issue.extra).length > 0 && (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Code className="h-4 w-4" />Extra Data</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono">{JSON.stringify(issue.extra, null, 2)}</pre>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Sidebar ── */}
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <p className="text-xl font-bold">{issue.count}</p>
              </div>
              <p className="text-xs text-muted-foreground">Events</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <p className="text-xl font-bold">{issue.user_count}</p>
              </div>
              <p className="text-xs text-muted-foreground">Users</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{new Date(issue.first_seen).toLocaleDateString()}</p>
              </div>
              <p className="text-xs text-muted-foreground">First seen</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{formatRelativeTime(issue.last_seen)}</p>
              </div>
              <p className="text-xs text-muted-foreground">Last seen</p>
            </div>
          </div>

          {/* Frequency Chart */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Frequency</CardTitle>
                <div className="flex gap-0.5">
                  {(["24h", "7d", "30d"] as const).map((period) => (
                    <Button key={period} variant={frequencyPeriod === period ? "secondary" : "ghost"} size="sm"
                      onClick={() => setFrequencyPeriod(period)} className="h-6 px-2 text-[10px]">{period}</Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {frequencyLoading ? (
                <div className="flex items-center justify-center h-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : frequencyData && frequencyData.total > 0 ? (
                <div>
                  <div className="h-24 flex items-end gap-0.5">
                    {(() => {
                      const buckets = frequencyPeriod === "24h"
                        ? frequencyData.buckets.reduce((acc, b, i) => {
                            const gi = Math.floor(i / 4);
                            if (!acc[gi]) acc[gi] = { timestamp: b.timestamp, count: 0 };
                            acc[gi]!.count += b.count;
                            return acc;
                          }, [] as { timestamp: string; count: number }[])
                        : frequencyData.buckets;
                      const max = Math.max(...buckets.map(b => b.count), 1);
                      return buckets.map((b, i) => (
                        <div key={i} className="flex-1 group relative">
                          <div className={`w-full rounded-t transition-colors ${b.count > 0 ? "bg-blue-600 hover:bg-blue-500" : "bg-muted"}`}
                            style={{ height: `${Math.max((b.count / max) * 100, b.count > 0 ? 15 : 3)}%`, minHeight: b.count > 0 ? '4px' : '2px' }} />
                          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded border shadow-sm whitespace-nowrap z-10">
                            {b.count}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{frequencyData.total} events in {frequencyPeriod}</p>
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
                <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5" />Impact</CardTitle>
                {impactData?.is_trending && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-full text-[10px] font-medium">
                    <Flame className="h-3 w-3" />Trending
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {impactLoading ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : impactData ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <div><p className="text-base font-semibold">{impactData.unique_users}</p><p className="text-[10px] text-muted-foreground">users</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                    <div><p className="text-base font-semibold">{impactData.unique_sessions}</p><p className="text-[10px] text-muted-foreground">sessions</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <div><p className="text-base font-semibold">{impactData.last_hour_count}</p><p className="text-[10px] text-muted-foreground">last hour</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    {impactData.trend_percent >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-red-500" /> : <TrendingDown className="h-3.5 w-3.5 text-green-500" />}
                    <div>
                      <p className={`text-base font-semibold ${impactData.trend_percent > 0 ? "text-red-600" : impactData.trend_percent < 0 ? "text-green-600" : ""}`}>
                        {impactData.trend_percent > 0 ? "+" : ""}{impactData.trend_percent}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">trend</p>
                    </div>
                  </div>
                </div>
              ) : <p className="text-xs text-muted-foreground py-2">No data</p>}
            </CardContent>
          </Card>

          {/* Tags */}
          {issue.tags && Object.keys(issue.tags).length > 0 && (
            <Card>
              <CardHeader className="pb-2 px-4 pt-4">
                <CardTitle className="text-sm flex items-center gap-2"><Tag className="h-3.5 w-3.5" />Tags</CardTitle>
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

          {/* Discussion */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />Discussion
                {comments.length > 0 && <span className="text-xs font-normal text-muted-foreground">({comments.length})</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex gap-2 mb-3">
                <textarea
                  ref={commentRef}
                  value={newComment}
                  onChange={handleTextareaChange}
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
                <Button size="sm" className="h-8 shrink-0" onClick={handleSubmitComment} disabled={submittingComment || !newComment.trim()}>
                  {submittingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">Cmd+Enter to submit</p>

              {commentsLoading ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No comments yet</p>
              ) : (
                <div className="space-y-2">
                  {(showAllComments ? comments : comments.slice(0, 3)).map((comment) => (
                    <div key={comment.id} className="group flex items-start gap-2 text-sm">
                      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">
                        {(comment.user_name ?? comment.user_email ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingCommentId === comment.id ? (
                          <div className="flex gap-1">
                            <input type="text" value={editingContent} onChange={(e) => setEditingContent(e.target.value)}
                              className="flex-1 h-6 rounded border bg-background px-2 text-xs" />
                            <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleUpdateComment(comment.id)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setEditingCommentId(null)}>×</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-xs">{comment.user_name || comment.user_email.split("@")[0]}</span>
                              <span className="text-xs text-muted-foreground">· {formatRelativeTime(comment.created_at)}</span>
                              <div className="ml-auto flex opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                                  onClick={() => { setEditingCommentId(comment.id); setEditingContent(comment.content); }}>
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => handleDeleteComment(comment.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{comment.content}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {comments.length > 3 && !showAllComments && (
                    <button onClick={() => setShowAllComments(true)}
                      className="text-xs text-primary hover:underline w-full text-center pt-1">
                      View all {comments.length} comments
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Event Inspector Modal */}
      {selectedEventId && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-3xl max-h-[85vh] translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg flex flex-col">
            <div className="flex items-center justify-between border-b p-4 shrink-0">
              <div>
                <h2 className="text-lg font-semibold">Event Details</h2>
                {eventDetail && <p className="text-sm text-muted-foreground">{new Date(eventDetail.timestamp).toLocaleString()}{eventDetail.release && ` • ${eventDetail.release}`}</p>}
              </div>
              <Button variant="ghost" size="icon" onClick={closeEventModal}><XCircle className="h-4 w-4" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {eventLoading && <div className="flex flex-col items-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="mt-4 text-sm text-muted-foreground">Loading...</p></div>}
              {eventDetail && !eventLoading && (
                <div className="space-y-6">
                  {eventDetail.exception && (
                    <div><h3 className="text-sm font-semibold mb-2">Exception</h3>
                      <div className="rounded-md border p-3 bg-muted/30"><p className="font-mono text-sm text-destructive">{eventDetail.exception.type}: {eventDetail.exception.value}</p></div>
                    </div>
                  )}
                  {eventDetail.user && (
                    <div><h3 className="text-sm font-semibold mb-2">User</h3>
                      <div className="grid gap-2 md:grid-cols-2">
                        {eventDetail.user.id && <div className="rounded-md border p-2"><span className="text-xs text-muted-foreground">ID</span><p className="font-mono text-sm">{eventDetail.user.id}</p></div>}
                        {eventDetail.user.email && <div className="rounded-md border p-2"><span className="text-xs text-muted-foreground">Email</span><p className="font-mono text-sm">{eventDetail.user.email}</p></div>}
                      </div>
                    </div>
                  )}
                  {eventDetail.tags && Object.keys(eventDetail.tags).length > 0 && (
                    <div><h3 className="text-sm font-semibold mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(eventDetail.tags).map(([key, value]) => (
                          <div key={key} className="rounded-md border px-2 py-1 text-xs"><span className="text-muted-foreground">{key}:</span> <span className="font-mono">{value}</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t p-4 shrink-0"><Button variant="outline" onClick={closeEventModal}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
