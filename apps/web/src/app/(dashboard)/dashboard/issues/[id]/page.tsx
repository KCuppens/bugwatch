"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
  ChevronDown,
  ChevronRight,
  Sparkles,
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
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
} from "lucide-react";
import { issuesApi, aiFixApi, type IssueDetail, type StackFrameDetail, type AiFix, type BreadcrumbDetail, type EventDetail, type FrequencyData, type ImpactData, type IssueComment } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTier } from "@/hooks/use-feature";
import { Badge } from "@/components/ui/badge";

// Mock data fallback for when API is not implemented
const mockIssue: IssueDetail = {
  id: "1",
  project_id: "1",
  fingerprint: "abc123def456",
  title: "TypeError: Cannot read property 'map' of undefined",
  level: "error",
  status: "unresolved",
  count: 142,
  user_count: 23,
  first_seen: "2024-01-12T10:30:00Z",
  last_seen: "2024-01-15T14:22:00Z",
  exception: {
    type: "TypeError",
    value: "Cannot read property 'map' of undefined",
    stacktrace: [
      {
        filename: "src/components/UserList.tsx",
        function: "UserList",
        lineno: 45,
        colno: 23,
        context_line: "    return users.map((user) => (",
        pre_context: [
          "  const { users } = props;",
          "",
          "  // Render the list of users",
        ],
        post_context: [
          "      <UserCard key={user.id} user={user} />",
          "    ));",
          "  };",
        ],
        in_app: true,
      },
      {
        filename: "src/pages/dashboard.tsx",
        function: "Dashboard",
        lineno: 78,
        colno: 12,
        context_line: "      <UserList users={data?.users} />",
        pre_context: [
          "    return (",
          '      <div className="container">',
        ],
        post_context: [
          "      </div>",
          "    );",
        ],
        in_app: true,
      },
      {
        filename: "node_modules/react-dom/cjs/react-dom.development.js",
        function: "renderWithHooks",
        lineno: 14985,
        colno: 18,
        in_app: false,
      },
    ],
  },
  recent_events: [
    { id: "evt1", timestamp: "2024-01-15T14:22:00Z", user_id: "usr_abc123", release: "v1.2.3" },
    { id: "evt2", timestamp: "2024-01-15T14:07:00Z", user_id: "usr_def456", release: "v1.2.3" },
    { id: "evt3", timestamp: "2024-01-15T13:52:00Z", release: "v1.2.3" },
    { id: "evt4", timestamp: "2024-01-15T13:37:00Z", user_id: "usr_ghi789", release: "v1.2.3" },
    { id: "evt5", timestamp: "2024-01-15T13:22:00Z", release: "v1.2.3" },
  ],
  tags: {
    browser: "Chrome 120",
    os: "macOS 14.2",
    url: "/dashboard",
    user_id: "usr_abc123",
  },
  breadcrumbs: [
    { timestamp: "2024-01-15T14:22:01Z", type: "navigation", category: "navigation", message: "Navigated to /dashboard", level: "info" },
    { timestamp: "2024-01-15T14:22:02Z", type: "http", category: "xhr", message: "GET /api/users - 200", level: "info" },
    { timestamp: "2024-01-15T14:22:03Z", type: "console", category: "console", message: "Data loaded successfully", level: "info" },
    { timestamp: "2024-01-15T14:22:03Z", type: "error", category: "error", message: "TypeError: Cannot read property 'map' of undefined", level: "error" },
  ],
  request: {
    url: "http://localhost:3000/dashboard",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    query_string: "tab=overview",
  },
  user: {
    id: "usr_abc123",
    email: "john@example.com",
    username: "johndoe",
    ip_address: "192.168.1.100",
  },
  extra: {
    component: "UserList",
    render_count: 3,
    last_action: "refresh_data",
  },
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
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

export default function IssueDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const issueId = params.id as string;
  const projectId = searchParams.get("project");

  // Auth and billing
  const { user } = useAuth();
  const { isPro } = useTier();
  const userCredits = user?.credits ?? 0;

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"debug" | "timeline" | "context">("debug");
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set([0]));
  const [isResolving, setIsResolving] = useState(false);
  const [isIgnoring, setIsIgnoring] = useState(false);

  // AI Fix state
  const [showAiFix, setShowAiFix] = useState(false);
  const [aiFix, setAiFix] = useState<AiFix | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixError, setAiFixError] = useState<string | null>(null);
  const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedForAi, setCopiedForAi] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Event inspector state
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(false);

  // Frequency chart state
  const [frequencyData, setFrequencyData] = useState<FrequencyData | null>(null);
  const [frequencyPeriod, setFrequencyPeriod] = useState<"24h" | "7d" | "30d">("24h");
  const [frequencyLoading, setFrequencyLoading] = useState(false);

  // Breadcrumb filter state
  const [breadcrumbFilter, setBreadcrumbFilter] = useState<string>("all");

  // Impact dashboard state
  const [impactData, setImpactData] = useState<ImpactData | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  // Comments state
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  // Keyboard shortcuts state
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  useEffect(() => {
    async function fetchIssue() {
      if (!projectId) {
        // Use mock data when no project ID
        setIssue(mockIssue);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await issuesApi.get(projectId, issueId);
        setIssue(response.data);
      } catch (err) {
        console.error("Failed to fetch issue:", err);
        // Fallback to mock data for demo purposes
        setIssue(mockIssue);
        setError(null); // Clear error since we're using fallback
      } finally {
        setIsLoading(false);
      }
    }

    fetchIssue();
  }, [issueId, projectId]);

  // Auto-expand all in-app stack frames when issue loads
  useEffect(() => {
    if (issue?.exception?.stacktrace) {
      const inAppFrameIndices = issue.exception.stacktrace
        .map((frame, index) => (frame.in_app ? index : -1))
        .filter((index) => index !== -1);

      // If there are in-app frames, expand them all; otherwise expand first frame
      if (inAppFrameIndices.length > 0) {
        setExpandedFrames(new Set(inAppFrameIndices));
      } else {
        setExpandedFrames(new Set([0]));
      }
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
      } catch (err) {
        console.error("Failed to fetch frequency:", err);
        setFrequencyData(null);
      } finally {
        setFrequencyLoading(false);
      }
    }

    if (issue) {
      fetchFrequency();
    }
  }, [issueId, projectId, frequencyPeriod, issue]);

  // Fetch impact data
  useEffect(() => {
    async function fetchImpact() {
      if (!projectId) return;

      setImpactLoading(true);
      try {
        const response = await issuesApi.getImpact(projectId, issueId);
        setImpactData(response.data);
      } catch (err) {
        console.error("Failed to fetch impact:", err);
        setImpactData(null);
      } finally {
        setImpactLoading(false);
      }
    }

    if (issue) {
      fetchImpact();
    }
  }, [issueId, projectId, issue]);

  // Fetch comments
  useEffect(() => {
    async function fetchComments() {
      if (!projectId) return;

      setCommentsLoading(true);
      try {
        const response = await issuesApi.listComments(projectId, issueId);
        setComments(response.data);
      } catch (err) {
        console.error("Failed to fetch comments:", err);
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    }

    if (issue) {
      fetchComments();
    }
  }, [issueId, projectId, issue]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // Ignore if modifiers are pressed (except for ? which needs shift)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "r":
          if (issue?.status !== "resolved" && !isResolving) {
            e.preventDefault();
            handleResolve();
          }
          break;
        case "i":
          if (issue?.status !== "ignored" && !isIgnoring) {
            e.preventDefault();
            handleIgnore();
          }
          break;
        case "c":
          e.preventDefault();
          handleCopyForAi();
          break;
        case "a":
          if (!aiFixLoading) {
            e.preventDefault();
            handleGenerateAiFix();
          }
          break;
        case "?":
          e.preventDefault();
          setShowKeyboardHelp((prev) => !prev);
          break;
        case "escape":
          if (showAiFix) {
            setShowAiFix(false);
          } else if (selectedEventId) {
            closeEventModal();
          } else if (showKeyboardHelp) {
            setShowKeyboardHelp(false);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [issue, isResolving, isIgnoring, aiFixLoading, showAiFix, selectedEventId, showKeyboardHelp]);

  // Handle event click
  async function handleEventClick(eventId: string) {
    if (!projectId) return;

    setSelectedEventId(eventId);
    setEventLoading(true);
    setEventDetail(null);

    try {
      const response = await issuesApi.getEvent(projectId, issueId, eventId);
      setEventDetail(response.data);
    } catch (err) {
      console.error("Failed to fetch event:", err);
    } finally {
      setEventLoading(false);
    }
  }

  function closeEventModal() {
    setSelectedEventId(null);
    setEventDetail(null);
  }

  function toggleFrame(index: number) {
    const newExpanded = new Set(expandedFrames);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedFrames(newExpanded);
  }

  async function handleResolve() {
    if (!issue || !projectId) return;

    setIsResolving(true);
    try {
      const response = await issuesApi.update(projectId, issueId, "resolved");
      setIssue({ ...issue, status: response.data.status });
    } catch (err) {
      console.error("Failed to resolve issue:", err);
      // Optimistic update for demo
      setIssue({ ...issue, status: "resolved" });
    } finally {
      setIsResolving(false);
    }
  }

  async function handleIgnore() {
    if (!issue || !projectId) return;

    setIsIgnoring(true);
    try {
      const response = await issuesApi.update(projectId, issueId, "ignored");
      setIssue({ ...issue, status: response.data.status });
    } catch (err) {
      console.error("Failed to ignore issue:", err);
      // Optimistic update for demo
      setIssue({ ...issue, status: "ignored" });
    } finally {
      setIsIgnoring(false);
    }
  }

  async function handleGenerateAiFix() {
    if (!issue) return;

    setShowAiFix(true);
    setAiFixLoading(true);
    setAiFixError(null);

    try {
      // Build request from issue data
      const request = {
        error_type: issue.exception?.type || "Error",
        error_message: issue.exception?.value || issue.title,
        stack_trace: (issue.exception?.stacktrace || []).map((frame) => ({
          filename: frame.filename,
          function: frame.function,
          lineno: frame.lineno,
          colno: frame.colno,
          context_line: frame.context_line,
          pre_context: frame.pre_context,
          post_context: frame.post_context,
          in_app: frame.in_app,
        })),
      };

      // Use standalone endpoint for demo, or project-specific if available
      const response = projectId
        ? await aiFixApi.generateFix(projectId, issueId, request)
        : await aiFixApi.generateFixStandalone(request);

      setAiFix(response.fix);
      setAiCreditsRemaining(response.credits_remaining);
    } catch (err) {
      console.error("Failed to generate AI fix:", err);
      setAiFixError(
        err instanceof Error ? err.message : "Failed to generate AI fix. Please try again."
      );
    } finally {
      setAiFixLoading(false);
    }
  }

  function handleCopyFix() {
    if (!aiFix) return;
    navigator.clipboard.writeText(aiFix.fix_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Generate formatted text for AI assistants
  function generateAiSummary(): string {
    if (!issue) return "";

    const lines: string[] = [];

    // Error header
    lines.push("# Error Report");
    lines.push("");
    lines.push(`**Error Type:** ${issue.exception?.type || "Unknown"}`);
    lines.push(`**Message:** ${issue.exception?.value || issue.title}`);
    lines.push(`**Level:** ${issue.level}`);
    lines.push(`**Status:** ${issue.status}`);
    lines.push(`**Occurrences:** ${issue.count} events affecting ${issue.user_count} users`);
    lines.push("");

    // Stack trace (top 5 frames)
    if (issue.exception?.stacktrace && issue.exception.stacktrace.length > 0) {
      lines.push("## Stack Trace");
      lines.push("```");
      issue.exception.stacktrace.slice(0, 5).forEach((frame) => {
        const inAppLabel = frame.in_app ? " [in-app]" : "";
        lines.push(`${frame.function || "(anonymous)"} at ${frame.filename}:${frame.lineno}${inAppLabel}`);
        if (frame.context_line) {
          lines.push(`  > ${frame.context_line.trim()}`);
        }
      });
      if (issue.exception.stacktrace.length > 5) {
        lines.push(`  ... and ${issue.exception.stacktrace.length - 5} more frames`);
      }
      lines.push("```");
      lines.push("");
    }

    // Request context
    if (issue.request?.url || issue.request?.method) {
      lines.push("## Request Context");
      if (issue.request.method && issue.request.url) {
        lines.push(`**${issue.request.method}** ${issue.request.url}`);
      }
      if (issue.request.query_string) {
        lines.push(`**Query:** ${issue.request.query_string}`);
      }
      lines.push("");
    }

    // User context (anonymized)
    if (issue.user) {
      lines.push("## User Context");
      if (issue.user.id) lines.push(`**User ID:** ${issue.user.id}`);
      if (issue.user.ip_address) lines.push(`**IP:** ${issue.user.ip_address.replace(/\d+\.\d+$/, "x.x")}`);
      lines.push("");
    }

    // Tags
    if (issue.tags && Object.keys(issue.tags).length > 0) {
      lines.push("## Tags");
      Object.entries(issue.tags).forEach(([key, value]) => {
        lines.push(`- **${key}:** ${value}`);
      });
      lines.push("");
    }

    // Breadcrumbs (last 5)
    if (issue.breadcrumbs && issue.breadcrumbs.length > 0) {
      lines.push("## Recent Breadcrumbs");
      issue.breadcrumbs.slice(-5).forEach((crumb) => {
        const time = new Date(crumb.timestamp).toLocaleTimeString();
        lines.push(`- [${time}] **${crumb.category}:** ${crumb.message || "(no message)"}`);
      });
      lines.push("");
    }

    return lines.join("\n");
  }

  function handleCopyForAi() {
    const summary = generateAiSummary();
    navigator.clipboard.writeText(summary);
    setCopiedForAi(true);
    setTimeout(() => setCopiedForAi(false), 2000);
  }

  // Generate cURL command from request context
  function generateCurlCommand(): string {
    if (!issue?.request) return "";

    const parts: string[] = ["curl"];

    // Method
    const method = issue.request.method || "GET";
    if (method !== "GET") {
      parts.push(`-X ${method}`);
    }

    // URL
    let url = issue.request.url || "";
    if (issue.request.query_string && !url.includes("?")) {
      url += `?${issue.request.query_string}`;
    }

    // Headers (filter sensitive ones)
    const sensitiveHeaders = ["authorization", "cookie", "x-api-key", "x-auth-token"];
    if (issue.request.headers) {
      Object.entries(issue.request.headers).forEach(([key, value]) => {
        if (sensitiveHeaders.includes(key.toLowerCase())) {
          parts.push(`-H "${key}: [REDACTED]"`);
        } else {
          parts.push(`-H "${key}: ${value}"`);
        }
      });
    }

    // Request body
    if (issue.request.data) {
      const data = typeof issue.request.data === "string"
        ? issue.request.data
        : JSON.stringify(issue.request.data);
      parts.push(`-d '${data}'`);
    }

    // Add URL last
    parts.push(`"${url}"`);

    return parts.join(" \\\n  ");
  }

  function handleCopyCurl() {
    const curl = generateCurlCommand();
    navigator.clipboard.writeText(curl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  }

  function handleCopyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  async function handleSubmitComment() {
    if (!projectId || !newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const response = await issuesApi.createComment(projectId, issueId, newComment.trim());
      setComments([response.data, ...comments]);
      setNewComment("");
    } catch (err) {
      console.error("Failed to create comment:", err);
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleUpdateComment(commentId: string) {
    if (!projectId || !editingContent.trim()) return;

    try {
      const response = await issuesApi.updateComment(projectId, issueId, commentId, editingContent.trim());
      setComments(comments.map(c => c.id === commentId ? response.data : c));
      setEditingCommentId(null);
      setEditingContent("");
    } catch (err) {
      console.error("Failed to update comment:", err);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!projectId) return;

    try {
      await issuesApi.deleteComment(projectId, issueId, commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-medium">Failed to load issue</h2>
        <p className="text-muted-foreground">{error || "Issue not found"}</p>
        <Link href="/dashboard">
          <Button>Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const stacktrace = issue.exception?.stacktrace || [];

  return (
    <div className="space-y-6">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-b mb-2">
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
              "bg-yellow-100 dark:bg-yellow-950"
            }`}>
              <AlertCircle className={`h-4 w-4 ${
                issue.level === "fatal" ? "text-red-600" :
                issue.level === "error" ? "text-orange-600" :
                "text-yellow-600"
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
                      issue.status === "resolved"
                        ? "bg-bug text-bug-foreground"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}>
                      {issue.status}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResolve}
              disabled={isResolving || issue.status === "resolved"}
              className="h-8"
            >
              {isResolving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3" />
              )}
              <span className="ml-1.5 hidden sm:inline">
                {issue.status === "resolved" ? "Resolved" : "Resolve"}
              </span>
            </Button>
            <Button
              size="sm"
              onClick={handleGenerateAiFix}
              disabled={aiFixLoading || (!isPro && userCredits === 0)}
              className="h-8"
              title={!isPro && userCredits === 0 ? "No credits available. Purchase credits to use AI Fix." : undefined}
            >
              {aiFixLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              <span className="ml-1.5 hidden sm:inline">AI Fix</span>
              {userCredits > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {userCredits}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Full Header (visible when scrolled to top) */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className={`rounded-md p-1.5 ${
                issue.level === "fatal" ? "bg-red-100 dark:bg-red-950" :
                issue.level === "error" ? "bg-orange-100 dark:bg-orange-950" :
                "bg-yellow-100 dark:bg-yellow-950"
              }`}>
                <AlertCircle className={`h-4 w-4 ${
                  issue.level === "fatal" ? "text-red-600" :
                  issue.level === "error" ? "text-orange-600" :
                  "text-yellow-600"
                }`} />
              </div>
              <span className={`text-sm font-medium uppercase ${
                issue.level === "fatal" ? "text-red-600" :
                issue.level === "error" ? "text-orange-600" :
                "text-yellow-600"
              }`}>
                {issue.level}
              </span>
              {issue.status !== "unresolved" && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  issue.status === "resolved"
                    ? "bg-bug text-bug-foreground"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                }`}>
                  {issue.status}
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-bold">{issue.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {issue.exception?.type} in {stacktrace[0]?.filename || "unknown"}
            </p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          ID: {issue.fingerprint?.slice(0, 8) || issue.id}
        </div>
      </div>

      {/* Quick Actions Bar */}
      <Card className="bg-muted/30">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleIgnore}
            disabled={isIgnoring || issue.status === "ignored"}
            className="h-8"
          >
            {isIgnoring ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <XCircle className="mr-2 h-3 w-3" />
            )}
            {issue.status === "ignored" ? "Ignored" : "Ignore"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResolve}
            disabled={isResolving || issue.status === "resolved"}
            className="h-8"
          >
            {isResolving ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-3 w-3" />
            )}
            {issue.status === "resolved" ? "Resolved" : "Resolve"}
          </Button>

          <div className="h-6 w-px bg-border mx-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="h-8"
          >
            {copiedLink ? (
              <>
                <CheckCircle className="mr-2 h-3 w-3 text-bug" />
                Copied!
              </>
            ) : (
              <>
                <LinkIcon className="mr-2 h-3 w-3" />
                Copy Link
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyForAi}
            className="h-8"
          >
            {copiedForAi ? (
              <>
                <CheckCircle className="mr-2 h-3 w-3 text-bug" />
                Copied!
              </>
            ) : (
              <>
                <Clipboard className="mr-2 h-3 w-3" />
                Copy for AI
              </>
            )}
          </Button>

          <div className="h-6 w-px bg-border mx-1" />

          <Button
            size="sm"
            onClick={handleGenerateAiFix}
            disabled={aiFixLoading || (!isPro && userCredits === 0)}
            className="h-8"
            title={!isPro && userCredits === 0 ? "No credits available. Purchase credits to use AI Fix." : undefined}
          >
            {aiFixLoading ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3 w-3" />
            )}
            AI Fix
            {userCredits > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                {userCredits}
              </Badge>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Stats Bar */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{issue.count}</p>
              <p className="text-xs text-muted-foreground">Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{issue.user_count}</p>
              <p className="text-xs text-muted-foreground">Users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {new Date(issue.first_seen).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted-foreground">First seen</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{formatRelativeTime(issue.last_seen)}</p>
              <p className="text-xs text-muted-foreground">Last seen</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{issue.recent_events[0]?.release || "-"}</p>
              <p className="text-xs text-muted-foreground">Release</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Frequency Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Error Frequency</CardTitle>
              {frequencyData && (
                <p className="text-sm text-muted-foreground mt-1">
                  {frequencyData.total} total events in the last {frequencyPeriod}
                </p>
              )}
            </div>
            <div className="flex gap-1">
              {(["24h", "7d", "30d"] as const).map((period) => (
                <Button
                  key={period}
                  variant={frequencyPeriod === period ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFrequencyPeriod(period)}
                  className="h-7 px-2 text-xs"
                >
                  {period}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {frequencyLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : frequencyData ? (
            frequencyData.total === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <p>No events in the last {frequencyPeriod}</p>
                <p className="text-sm mt-1">Try selecting a longer time period</p>
              </div>
            ) : (
              <div>
                {/* Chart */}
                <div className="h-40 flex items-end gap-1 relative">
                  {/* Y-axis grid lines */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="border-t border-muted/30 w-full" />
                    ))}
                  </div>

                  {/* Bars */}
                  {(() => {
                    // Group buckets for 24h to make it clearer (4-hour groups = 6 bars)
                    const displayBuckets = frequencyPeriod === "24h"
                      ? frequencyData.buckets.reduce((acc, bucket, index) => {
                          const groupIndex = Math.floor(index / 4);
                          if (!acc[groupIndex]) {
                            acc[groupIndex] = {
                              timestamp: bucket.timestamp,
                              count: 0,
                              startHour: new Date(bucket.timestamp).getHours()
                            };
                          }
                          acc[groupIndex].count += bucket.count;
                          return acc;
                        }, [] as { timestamp: string; count: number; startHour: number }[])
                      : frequencyData.buckets;

                    const maxCount = Math.max(...displayBuckets.map(b => b.count), 1);

                    return displayBuckets.map((bucket, index) => {
                      const height = (bucket.count / maxCount) * 100;
                      const barHeight = Math.max(height, bucket.count > 0 ? 15 : 3);
                      return (
                        <div
                          key={index}
                          className="flex-1 flex flex-col items-center justify-end group relative z-10"
                        >
                          <div
                            className={`w-full rounded-t transition-colors ${
                              bucket.count > 0
                                ? "bg-blue-600 hover:bg-blue-700"
                                : "bg-slate-200 dark:bg-slate-700"
                            }`}
                            style={{ height: `${barHeight}%`, minHeight: bucket.count > 0 ? '8px' : '4px' }}
                          />
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 hidden group-hover:block bg-popover text-popover-foreground text-xs px-3 py-2 rounded-md shadow-lg border whitespace-nowrap z-20">
                            <div className="font-semibold">{bucket.count} event{bucket.count !== 1 ? "s" : ""}</div>
                            <div className="text-muted-foreground">
                              {frequencyPeriod === "24h" ? (
                                <>
                                  {('startHour' in bucket) && `${(bucket as { startHour: number }).startHour}:00 - ${((bucket as { startHour: number }).startHour + 4) % 24}:00`}
                                </>
                              ) : (
                                new Date(bucket.timestamp).toLocaleDateString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric"
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* X-axis labels */}
                <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                  {frequencyPeriod === "24h" ? (
                    <>
                      <span>24h ago</span>
                      <span>18h</span>
                      <span>12h</span>
                      <span>6h</span>
                      <span>Now</span>
                    </>
                  ) : frequencyPeriod === "7d" ? (
                    <>
                      <span>7 days ago</span>
                      <span>4 days</span>
                      <span>Today</span>
                    </>
                  ) : (
                    <>
                      <span>30 days ago</span>
                      <span>20 days</span>
                      <span>10 days</span>
                      <span>Today</span>
                    </>
                  )}
                </div>
              </div>
            )
          ) : (
            <p className="text-center text-muted-foreground py-8">No frequency data available</p>
          )}
        </CardContent>
      </Card>

      {/* Impact & Discussion - Compact Side by Side */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Impact Analysis - Compact */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Impact
              </CardTitle>
              {impactData?.is_trending && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-full text-xs font-medium">
                  <Flame className="h-3 w-3" />
                  Trending
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {impactLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : impactData ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-lg font-semibold">{impactData.unique_users}</p>
                    <p className="text-xs text-muted-foreground">users</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-lg font-semibold">{impactData.unique_sessions}</p>
                    <p className="text-xs text-muted-foreground">sessions</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-lg font-semibold">{impactData.last_hour_count}</p>
                    <p className="text-xs text-muted-foreground">last hour</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {impactData.trend_percent >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-red-500 shrink-0" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-bug shrink-0" />
                  )}
                  <div>
                    <p className={`text-lg font-semibold ${
                      impactData.trend_percent > 0 ? "text-red-600" : impactData.trend_percent < 0 ? "text-bug" : ""
                    }`}>
                      {impactData.trend_percent > 0 ? "+" : ""}{impactData.trend_percent}%
                    </p>
                    <p className="text-xs text-muted-foreground">trend</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">No data</p>
            )}
          </CardContent>
        </Card>

        {/* Discussion - Compact */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Discussion
              {comments.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({comments.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Compact comment input */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 h-8 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitComment();
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8"
                onClick={handleSubmitComment}
                disabled={submittingComment || !newComment.trim()}
              >
                {submittingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Compact comments list */}
            {commentsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No comments yet</p>
            ) : (
              <div className="space-y-2 max-h-28 overflow-y-auto">
                {comments.slice(0, 5).map((comment) => (
                  <div key={comment.id} className="group flex items-start gap-2 text-sm">
                    <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0">
                      {(comment.user_name ?? comment.user_email ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingCommentId === comment.id ? (
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="flex-1 h-6 rounded border bg-background px-2 text-xs"
                          />
                          <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleUpdateComment(comment.id)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setEditingCommentId(null)}>
                            ✕
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-xs">
                              {comment.user_name || comment.user_email.split("@")[0]}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              · {formatRelativeTime(comment.created_at)}
                            </span>
                            <div className="ml-auto flex opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => {
                                  setEditingCommentId(comment.id);
                                  setEditingContent(comment.content);
                                }}
                              >
                                <Edit3 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 text-destructive"
                                onClick={() => handleDeleteComment(comment.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{comment.content}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {comments.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{comments.length - 5} more
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs - Consolidated for better UX */}
      <div className="border-b">
        <div className="flex gap-1">
          {([
            { id: "debug", label: "Debug", icon: "▣", description: "Stack trace & variables" },
            { id: "timeline", label: "Timeline", icon: "◷", description: "Breadcrumbs & events" },
            { id: "context", label: "Context", icon: "📊", description: "Request, user & tags" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-bug text-foreground bg-muted/50"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "debug" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5" />
                  Stack Trace
                </CardTitle>
                <CardDescription>
                  {issue.exception?.type}: {issue.exception?.value}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {stacktrace.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No stack trace available
              </p>
            ) : (
              stacktrace.map((frame: StackFrameDetail, index: number) => (
                <div
                  key={index}
                  className={`rounded-md border ${
                    frame.in_app ? "border-primary/20 bg-primary/5" : "bg-muted/50"
                  }`}
                >
                  <button
                    onClick={() => toggleFrame(index)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    {expandedFrames.has(index) ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium truncate">
                          {frame.function}
                        </span>
                        {frame.in_app && (
                          <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-xs font-medium text-primary">
                            in-app
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {frame.filename}:{frame.lineno}:{frame.colno}
                      </p>
                    </div>
                    {frame.in_app && (
                      <Button variant="ghost" size="sm" className="shrink-0">
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </button>

                  {expandedFrames.has(index) && frame.context_line && (
                    <div className="border-t bg-zinc-950 p-3 font-mono text-sm">
                      {frame.pre_context?.map((line, i) => (
                        <div key={`pre-${i}`} className="text-zinc-500">
                          <span className="mr-4 inline-block w-8 text-right text-zinc-600">
                            {frame.lineno - (frame.pre_context?.length || 0) + i}
                          </span>
                          {line || " "}
                        </div>
                      ))}
                      <div className="bg-red-500/20 text-red-300">
                        <span className="mr-4 inline-block w-8 text-right text-red-400">
                          {frame.lineno}
                        </span>
                        {frame.context_line}
                      </div>
                      {frame.post_context?.map((line, i) => (
                        <div key={`post-${i}`} className="text-zinc-500">
                          <span className="mr-4 inline-block w-8 text-right text-zinc-600">
                            {frame.lineno + i + 1}
                          </span>
                          {line || " "}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Variable Inspector */}
                  {expandedFrames.has(index) && frame.vars && Object.keys(frame.vars).length > 0 && (
                    <div className="border-t p-3 bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Code className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Local Variables</span>
                      </div>
                      <div className="grid gap-1">
                        {Object.entries(frame.vars).map(([name, val]) => {
                          const displayValue = typeof val === "object" && val !== null
                            ? JSON.stringify(val, null, 2)
                            : String(val ?? "null");
                          return (
                            <div key={name} className="flex items-start gap-2 font-mono text-xs">
                              <span className="text-blue-600 dark:text-blue-400 font-medium shrink-0">
                                {name}
                              </span>
                              <span className="text-muted-foreground">=</span>
                              <span className="text-green-600 dark:text-green-400 break-all">
                                {displayValue}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* Timeline Tab - Breadcrumbs + Events Combined */}
      {activeTab === "timeline" && (
        <div className="space-y-4">
          {/* Breadcrumbs Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Breadcrumbs ({issue.breadcrumbs?.length || 0})</CardTitle>
                  {issue.breadcrumbs && issue.breadcrumbs.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <select
                        value={breadcrumbFilter}
                        onChange={(e) => setBreadcrumbFilter(e.target.value)}
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
              </div>
            </CardHeader>
            <CardContent>
              {(!issue.breadcrumbs || issue.breadcrumbs.length === 0) ? (
                <p className="text-center text-muted-foreground py-6 text-sm">
                  No breadcrumbs captured
                </p>
              ) : (
                (() => {
                  const filteredBreadcrumbs = issue.breadcrumbs.filter((crumb) => {
                    if (breadcrumbFilter !== "all") {
                      const crumbCategory = (crumb.category || crumb.type || "").toLowerCase();
                      if (breadcrumbFilter === "http" && !["http", "xhr", "fetch"].includes(crumbCategory)) return false;
                      if (breadcrumbFilter === "navigation" && crumbCategory !== "navigation") return false;
                      if (breadcrumbFilter === "console" && crumbCategory !== "console") return false;
                      if (breadcrumbFilter === "error" && crumb.level !== "error") return false;
                    }
                    return true;
                  });

                  if (filteredBreadcrumbs.length === 0) {
                    return <p className="text-center text-muted-foreground py-6 text-sm">No matching breadcrumbs</p>;
                  }

                  return (
                    <div className="relative">
                      <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />
                      <div className="space-y-2">
                        {filteredBreadcrumbs.map((crumb: BreadcrumbDetail, index: number) => {
                          const isError = crumb.level === "error";
                          const dotColor = isError ? "bg-red-500" : crumb.type === "http" ? "bg-blue-500" : "bg-gray-400";
                          return (
                            <div key={index} className="relative flex items-start gap-3 pl-8">
                              <div className={`absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${dotColor} ring-2 ring-background`} />
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
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </CardContent>
          </Card>

          {/* Events Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Events ({issue.recent_events.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {issue.recent_events.map((event, index) => (
                  <button
                    key={event.id}
                    onClick={() => handleEventClick(event.id)}
                    className="w-full flex items-center justify-between rounded-md border p-2 hover:bg-muted/50 transition-colors text-left"
                  >
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

      {/* Context Tab - Request + User + Tags + Extra Combined */}
      {activeTab === "context" && (
        <div className="space-y-4">
          {/* Request Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Request
                </CardTitle>
                {issue.request?.url && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyCurl}>
                    {copiedCurl ? <CheckCircle className="mr-1 h-3 w-3 text-green-600" /> : <Terminal className="mr-1 h-3 w-3" />}
                    {copiedCurl ? "Copied" : "cURL"}
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
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs font-medium text-primary">{issue.request.method}</span>
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
                        {(Object.entries(issue.request.headers) as Array<[string, string]>).map(([key, val]) => (
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

          {/* User Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                User
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!issue.user ? (
                <p className="text-sm text-muted-foreground">No user context</p>
              ) : (
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
              )}
            </CardContent>
          </Card>

          {/* Tags Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Tags ({Object.keys(issue.tags || {}).length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(issue.tags || {}).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(issue.tags || {}).map(([key, value]) => (
                    <div key={key} className="rounded-md border px-2 py-1 text-xs">
                      <span className="text-muted-foreground">{key}:</span>
                      <span className="ml-1 font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extra Context Section */}
          {issue.extra && Object.keys(issue.extra).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Code className="h-4 w-4" />
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

      {/* AI Fix Modal */}
      {showAiFix && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg">
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">AI Fix Suggestion</h2>
                {aiCreditsRemaining !== null && (
                  <span className="text-xs text-muted-foreground">
                    ({aiCreditsRemaining} credits remaining)
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAiFix(false)}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              {aiFixLoading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Analyzing error and generating fix...
                  </p>
                </div>
              )}

              {aiFixError && (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="mt-4 text-sm text-destructive">{aiFixError}</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={handleGenerateAiFix}
                  >
                    Try Again
                  </Button>
                </div>
              )}

              {aiFix && !aiFixLoading && (
                <div className="space-y-6">
                  {/* Confidence */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Confidence:</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          aiFix.confidence >= 0.8
                            ? "bg-green-500"
                            : aiFix.confidence >= 0.5
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${aiFix.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium">
                      {Math.round(aiFix.confidence * 100)}%
                    </span>
                  </div>

                  {/* Explanation */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Explanation</h3>
                    <p className="text-sm text-muted-foreground">{aiFix.explanation}</p>
                  </div>

                  {/* Fix Code */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold">Suggested Fix</h3>
                      <Button variant="outline" size="sm" onClick={handleCopyFix}>
                        {copied ? (
                          <>
                            <CheckCircle className="mr-2 h-3 w-3" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="mr-2 h-3 w-3" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-md overflow-x-auto text-sm font-mono">
                      {aiFix.fix_code}
                    </pre>
                  </div>

                  {/* Recommendations */}
                  {aiFix.recommendations.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Recommendations</h3>
                      <ul className="space-y-2">
                        {aiFix.recommendations.map((rec, index) => (
                          <li
                            key={index}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <span className="text-primary mt-0.5">•</span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {aiFix && !aiFixLoading && (
              <div className="flex justify-end gap-2 border-t p-4">
                <Button variant="outline" onClick={() => setShowAiFix(false)}>
                  Close
                </Button>
                <Button onClick={handleCopyFix}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Fix
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Event Inspector Modal */}
      {selectedEventId && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-3xl max-h-[85vh] translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg flex flex-col">
            <div className="flex items-center justify-between border-b p-4 shrink-0">
              <div>
                <h2 className="text-lg font-semibold">Event Details</h2>
                {eventDetail && (
                  <p className="text-sm text-muted-foreground">
                    {new Date(eventDetail.timestamp).toLocaleString()}
                    {eventDetail.environment && ` • ${eventDetail.environment}`}
                    {eventDetail.release && ` • ${eventDetail.release}`}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={closeEventModal}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {eventLoading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="mt-4 text-sm text-muted-foreground">Loading event details...</p>
                </div>
              )}

              {eventDetail && !eventLoading && (
                <div className="space-y-6">
                  {/* Exception */}
                  {eventDetail.exception && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Exception</h3>
                      <div className="rounded-md border p-3 bg-muted/30">
                        <p className="font-mono text-sm text-destructive">
                          {eventDetail.exception.type}: {eventDetail.exception.value}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* User Context */}
                  {eventDetail.user && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">User</h3>
                      <div className="grid gap-2 md:grid-cols-2">
                        {eventDetail.user.id && (
                          <div className="rounded-md border p-2">
                            <span className="text-xs text-muted-foreground">ID</span>
                            <p className="font-mono text-sm">{eventDetail.user.id}</p>
                          </div>
                        )}
                        {eventDetail.user.email && (
                          <div className="rounded-md border p-2">
                            <span className="text-xs text-muted-foreground">Email</span>
                            <p className="font-mono text-sm">{eventDetail.user.email}</p>
                          </div>
                        )}
                        {eventDetail.user.username && (
                          <div className="rounded-md border p-2">
                            <span className="text-xs text-muted-foreground">Username</span>
                            <p className="font-mono text-sm">{eventDetail.user.username}</p>
                          </div>
                        )}
                        {eventDetail.user.ip_address && (
                          <div className="rounded-md border p-2">
                            <span className="text-xs text-muted-foreground">IP</span>
                            <p className="font-mono text-sm">{eventDetail.user.ip_address}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Request Context */}
                  {eventDetail.request && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Request</h3>
                      <div className="rounded-md border p-3 bg-muted/30">
                        <div className="flex items-center gap-2">
                          {eventDetail.request.method && (
                            <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                              {eventDetail.request.method}
                            </span>
                          )}
                          <span className="font-mono text-sm break-all">
                            {eventDetail.request.url || "(no URL)"}
                          </span>
                        </div>
                        {eventDetail.request.headers && Object.keys(eventDetail.request.headers).length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-muted-foreground mb-2">Headers</p>
                            <div className="space-y-1">
                              {Object.entries(eventDetail.request.headers).slice(0, 5).map(([key, value]) => (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="text-muted-foreground">{key}:</span>
                                  <span className="font-mono truncate">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Breadcrumbs */}
                  {eventDetail.breadcrumbs && eventDetail.breadcrumbs.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">
                        Breadcrumbs ({eventDetail.breadcrumbs.length})
                      </h3>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {eventDetail.breadcrumbs.slice(-10).map((crumb, index) => (
                          <div
                            key={index}
                            className={`flex items-start gap-2 text-xs rounded-md border p-2 ${
                              crumb.level === "error" ? "border-red-200 dark:border-red-900" : ""
                            }`}
                          >
                            <span className="text-muted-foreground font-mono shrink-0">
                              {new Date(crumb.timestamp).toLocaleTimeString()}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 text-xs ${
                                crumb.level === "error"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {crumb.category}
                            </span>
                            <span className="truncate">{crumb.message || "(no message)"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {eventDetail.tags && Object.keys(eventDetail.tags).length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(eventDetail.tags).map(([key, value]) => (
                          <div key={key} className="rounded-md border px-2 py-1 text-xs">
                            <span className="text-muted-foreground">{key}:</span>{" "}
                            <span className="font-mono">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Extra Context */}
                  {eventDetail.extra && Object.keys(eventDetail.extra).length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Extra Context</h3>
                      <pre className="bg-zinc-950 text-zinc-100 p-3 rounded-md overflow-x-auto text-xs font-mono">
                        {JSON.stringify(eventDetail.extra, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t p-4 shrink-0">
              <Button variant="outline" onClick={closeEventModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setShowKeyboardHelp(false)}>
          <div
            className="fixed left-[50%] top-[50%] z-50 w-full max-w-sm translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowKeyboardHelp(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Resolve issue</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">R</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Ignore issue</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">I</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Copy for AI</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">C</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Generate AI Fix</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">A</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Show shortcuts</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">?</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Close modal</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">Esc</kbd>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">?</kbd> anytime to toggle this help
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
