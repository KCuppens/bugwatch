"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Users,
  TrendingUp,
  TrendingDown,
  Zap,
  Check,
  MoreHorizontal,
  ChevronRight,
  Activity,
  Flame,
  Search,
  RefreshCw,
  Bell,
  Globe,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Signal,
} from "lucide-react";
import {
  overviewApi,
  issuesApi,
  type IssueWithProject,
  type ProjectStatsWithInfo,
  type AggregateTotals,
  type AlertLogWithProjectInfo,
  type MonitorWithProjectInfo,
  type MonitorsSummary,
} from "@/lib/api";
import { ENVIRONMENT_COLORS } from "@/lib/search";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const levelConfig = {
  fatal: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-l-red-500",
    badge: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  error: {
    icon: AlertCircle,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-l-orange-500",
    badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-l-yellow-500",
    badge: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  },
  info: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-l-info-500",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
};

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "bg-purple-500/15 text-purple-400 border-purple-500/30",
    "bg-pink-500/15 text-pink-400 border-pink-500/30",
    "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    "bg-teal-500/15 text-teal-400 border-teal-500/30",
    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ] as const;
  return colors[Math.abs(hash) % colors.length] ?? colors[0];
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "-";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now"; // future date (clock skew)

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function generateTrendData(
  count: number,
  firstSeen: string
): { trend: "up" | "down" | "stable"; percentage: number } {
  const hoursSinceFirst =
    (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60);
  if (hoursSinceFirst < 2)
    return { trend: "up", percentage: Math.min(500, Math.round(count * 10)) };
  if (hoursSinceFirst < 24)
    return { trend: "up", percentage: Math.round(50 + Math.random() * 150) };
  if (count > 100) return { trend: "stable", percentage: 0 };
  return { trend: "down", percentage: Math.round(10 + Math.random() * 30) };
}

// ---------- Skeleton Components ----------

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
    </div>
  );
}

function IssueListSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 border-b">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SidePanelSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 border-b">
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-5 w-5 rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-3.5 w-2/3 mb-1.5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Alert Status Badge ----------

function AlertStatusBadge({ status }: { status: string }) {
  const config = {
    sent: { label: "Sent", className: "bg-emerald-500/10 text-emerald-500" },
    failed: { label: "Failed", className: "bg-red-500/10 text-red-500" },
    pending: { label: "Pending", className: "bg-yellow-500/10 text-yellow-500" },
  }[status] ?? { label: status, className: "bg-muted text-muted-foreground" };

  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", config.className)}>
      {config.label}
    </span>
  );
}

// ---------- Main Page ----------

export default function OverviewPage() {
  const [issues, setIssues] = useState<IssueWithProject[]>([]);
  const [stats, setStats] = useState<ProjectStatsWithInfo[]>([]);
  const [totals, setTotals] = useState<AggregateTotals>({
    unresolved: 0,
    events: 0,
    users: 0,
    critical: 0,
  });
  const [alertLogs, setAlertLogs] = useState<AlertLogWithProjectInfo[]>([]);
  const [monitors, setMonitors] = useState<MonitorWithProjectInfo[]>([]);
  const [monitorsSummary, setMonitorsSummary] = useState<MonitorsSummary>({
    total: 0,
    up: 0,
    down: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [resolvingIssue, setResolvingIssue] = useState<string | null>(null);

  // Filter issues by search query
  const filteredIssues = useMemo(() => {
    if (!searchQuery.trim()) return issues;
    const query = searchQuery.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(query) ||
        issue.project_name.toLowerCase().includes(query)
    );
  }, [issues, searchQuery]);

  // Fetch data — core (issues/stats) must succeed; alerts/monitors degrade gracefully
  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Core data — if these fail, show error
      const [issuesRes, statsRes] = await Promise.all([
        overviewApi.getIssuesAcrossProjects({ status: "unresolved", limit: 10 }),
        overviewApi.getStatsByProject(),
      ]);

      setIssues(issuesRes.data);
      setStats(statsRes.data);
      setTotals(statsRes.totals);

      // Supplementary data — fail silently to avoid breaking the page
      const [alertsRes, monitorsRes] = await Promise.all([
        overviewApi.getAlertLogsAcrossProjects(10).catch((err) => {
          console.warn("Failed to fetch alerts:", err);
          return { data: [] as AlertLogWithProjectInfo[] };
        }),
        overviewApi.getMonitorsAcrossProjects().catch((err) => {
          console.warn("Failed to fetch monitors:", err);
          return {
            data: [] as MonitorWithProjectInfo[],
            summary: { total: 0, up: 0, down: 0 } as MonitorsSummary,
          };
        }),
      ]);

      setAlertLogs(alertsRes.data);
      setMonitors(monitorsRes.data);
      setMonitorsSummary(monitorsRes.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview data");
      toast.error("Failed to load overview data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleResolveIssue = useCallback(
    async (issueId: string, projectId: string) => {
      setResolvingIssue(issueId);
      try {
        await issuesApi.update(projectId, issueId, "resolved");
        setIssues((prev) => prev.filter((i) => i.id !== issueId));
        setTotals((prev) => ({
          ...prev,
          unresolved: Math.max(0, prev.unresolved - 1),
        }));
        setStats((prev) =>
          prev.map((s) =>
            s.project_id === projectId
              ? { ...s, unresolved_count: Math.max(0, s.unresolved_count - 1) }
              : s
          )
        );
      } catch (err) {
        toast.error("Failed to resolve issue");
        fetchData();
      } finally {
        setResolvingIssue(null);
      }
    },
    [fetchData]
  );

  if (error && stats.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 flex items-center justify-center mb-6">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">Failed to load</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button onClick={fetchData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!isLoading && !error && stats.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6">
            <Bug className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first project to start tracking errors across your
            applications.
          </p>
          <Link href="/dashboard/projects/new">
            <Button size="lg" className="gap-2">
              <Zap className="h-4 w-4" />
              Create Project
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">Overview</h1>
          <span className="text-sm text-muted-foreground">All projects</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={fetchData}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Activity className="h-4 w-4 mr-2" />
            Live
            <span className="ml-2 h-2 w-2 rounded-full bg-bug animate-pulse" />
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Unresolved */}
          <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Unresolved
                </p>
                <p className="text-2xl font-bold mt-1">{totals.unresolved}</p>
              </div>
              <div
                className={cn(
                  "p-2 rounded-lg",
                  totals.unresolved > 0 ? "bg-orange-500/10" : "bg-bug/10"
                )}
              >
                <AlertCircle
                  className={cn(
                    "h-5 w-5",
                    totals.unresolved > 0 ? "text-orange-500" : "text-bug"
                  )}
                />
              </div>
            </div>
            {totals.critical > 0 && (
              <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                <Flame className="h-3 w-3" />
                {totals.critical} critical
              </p>
            )}
          </div>

          {/* Total Events */}
          <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Total Events
                </p>
                <p className="text-2xl font-bold mt-1">
                  {totals.events.toLocaleString()}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-3/4 bg-gradient-to-r from-blue-500 to-primary rounded-full" />
              </div>
            </div>
          </div>

          {/* Users Affected */}
          <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Users Affected
                </p>
                <p className="text-2xl font-bold mt-1">
                  {totals.users.toLocaleString()}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Users className="h-5 w-5 text-purple-500" />
              </div>
            </div>
          </div>

          {/* Uptime Health (replaces Projects count) */}
          <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Uptime Health
                </p>
                <p className="text-2xl font-bold mt-1">
                  {monitorsSummary.total > 0
                    ? `${monitorsSummary.up}/${monitorsSummary.total}`
                    : "-"}
                </p>
              </div>
              <div
                className={cn(
                  "p-2 rounded-lg",
                  monitorsSummary.down > 0
                    ? "bg-red-500/10"
                    : "bg-emerald-500/10"
                )}
              >
                <Signal
                  className={cn(
                    "h-5 w-5",
                    monitorsSummary.down > 0
                      ? "text-red-500"
                      : "text-emerald-500"
                  )}
                />
              </div>
            </div>
            {monitorsSummary.total > 0 ? (
              <p
                className={cn(
                  "text-xs mt-2 flex items-center gap-1",
                  monitorsSummary.down > 0
                    ? "text-red-500"
                    : "text-emerald-500"
                )}
              >
                {monitorsSummary.down > 0 ? (
                  <>
                    <XCircle className="h-3 w-3" />
                    {monitorsSummary.down} down
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    All monitors up
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                No monitors configured
              </p>
            )}
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search issues by title or project..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-10 pl-10 pr-4 rounded-lg border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
        />
      </div>

      {/* Main Content: Issues + Right Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Latest Issues (2/3) */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <IssueListSkeleton />
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Bug className="h-4 w-4 text-muted-foreground" />
                  Latest Issues
                </h2>
                <Link
                  href="/dashboard"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  View all issues
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>

              {filteredIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  {searchQuery ? (
                    <>
                      <Search className="h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium mb-1">No matches</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        No issues match &quot;{searchQuery}&quot;
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSearchQuery("")}
                      >
                        Clear search
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-bug/10 flex items-center justify-center mb-3">
                        <Check className="h-6 w-6 text-bug" />
                      </div>
                      <p className="text-sm font-medium mb-1">All clear!</p>
                      <p className="text-xs text-muted-foreground">
                        No unresolved issues across all projects
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {filteredIssues.map((issue) => {
                    const config =
                      levelConfig[issue.level as keyof typeof levelConfig] ||
                      levelConfig.error;
                    const Icon = config.icon;
                    const isHovered = hoveredIssue === issue.id;
                    const trend = generateTrendData(issue.count, issue.first_seen);
                    const isRecent =
                      Date.now() - new Date(issue.last_seen).getTime() <
                      1000 * 60 * 5;
                    const projectColor = stringToColor(
                      issue.project_slug || issue.project_name
                    );

                    return (
                      <div
                        key={issue.id}
                        className={cn(
                          "group relative flex items-center gap-4 border-l-4 transition-all duration-200",
                          config.border,
                          isHovered ? "bg-muted/30" : ""
                        )}
                        onMouseEnter={() => setHoveredIssue(issue.id)}
                        onMouseLeave={() => setHoveredIssue(null)}
                      >
                        <Link
                          href={`/dashboard/issues/${issue.id}?project=${issue.project_id}`}
                          className="flex-1 flex items-center gap-4 py-3 px-4"
                        >
                          {/* Icon */}
                          <div
                            className={cn(
                              "shrink-0 p-2 rounded-lg transition-transform group-hover:scale-110",
                              config.bg
                            )}
                          >
                            <Icon className={cn("h-4 w-4", config.color)} />
                          </div>

                          {/* Title & Meta */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm truncate">
                                {issue.title}
                              </p>
                              {issue.environment && issue.environment !== "production" && (
                                <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                  (ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.bg
                                } ${
                                  (ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.text
                                }`}>
                                  {issue.environment}
                                </span>
                              )}
                              {isRecent && (
                                <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-bug/10 text-bug text-[10px] font-medium">
                                  <span className="w-1.5 h-1.5 rounded-full bg-bug animate-pulse" />
                                  NEW
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                  projectColor
                                )}
                              >
                                {issue.project_name}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Activity className="h-3 w-3" />
                                {issue.count.toLocaleString()}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                {issue.user_count}
                              </span>
                            </div>
                          </div>

                          {/* Trend & Time */}
                          <div className="flex items-center gap-3 shrink-0">
                            <div
                              className={cn(
                                "flex items-center gap-1 text-xs font-medium transition-opacity",
                                isHovered
                                  ? "opacity-0 w-0 overflow-hidden"
                                  : "opacity-100 w-auto",
                                trend.trend === "up"
                                  ? "text-red-500"
                                  : trend.trend === "down"
                                  ? "text-accent"
                                  : "text-muted-foreground"
                              )}
                            >
                              {trend.trend === "up" ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : trend.trend === "down" ? (
                                <TrendingDown className="h-3 w-3" />
                              ) : null}
                              {trend.percentage > 0 && (
                                <span>
                                  {trend.trend === "up" ? "+" : "-"}
                                  {trend.percentage}%
                                </span>
                              )}
                            </div>

                            <span
                              className={cn(
                                "text-xs text-muted-foreground text-right transition-opacity",
                                isHovered
                                  ? "opacity-0 w-0 overflow-hidden"
                                  : "opacity-100 w-16"
                              )}
                            >
                              {formatRelativeTime(issue.last_seen)}
                            </span>

                            {/* Quick Actions on hover */}
                            <div
                              className={cn(
                                "flex items-center gap-1 transition-all",
                                isHovered
                                  ? "opacity-100 w-auto"
                                  : "opacity-0 w-0 overflow-hidden"
                              )}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                disabled={resolvingIssue === issue.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleResolveIssue(
                                    issue.id,
                                    issue.project_id
                                  );
                                }}
                              >
                                {resolvingIssue === issue.id ? (
                                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3 mr-1" />
                                )}
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </div>

                            {!isHovered && (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Uptime + Alerts */}
        <div className="space-y-6">
          {/* Uptime Status */}
          {isLoading ? (
            <SidePanelSkeleton />
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Uptime Status
                </h2>
                <Link
                  href="/dashboard/uptime"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  View uptime
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>

              {monitors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10">
                  <Globe className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No active monitors
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="px-4 py-3 border-b bg-muted/20">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          monitorsSummary.down > 0
                            ? "bg-red-500"
                            : "bg-emerald-500"
                        )}
                      />
                      <span className="text-muted-foreground">
                        {monitorsSummary.up} up
                        {monitorsSummary.down > 0 && (
                          <span className="text-red-500">
                            {" "}
                            / {monitorsSummary.down} down
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
                    {monitors.map((monitor) => {
                      const isDown = monitor.current_status === "down";
                      const projectColor = stringToColor(monitor.project_name);
                      return (
                        <div
                          key={monitor.id}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                        >
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full shrink-0",
                              isDown ? "bg-red-500" : "bg-emerald-500"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {monitor.name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className={cn(
                                  "px-1 py-0 rounded text-[9px] font-medium border",
                                  projectColor
                                )}
                              >
                                {monitor.project_name}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {monitor.uptime_24h != null && (
                              <p
                                className={cn(
                                  "text-xs font-medium",
                                  monitor.uptime_24h >= 99.9
                                    ? "text-emerald-500"
                                    : monitor.uptime_24h >= 95
                                    ? "text-yellow-500"
                                    : "text-red-500"
                                )}
                              >
                                {monitor.uptime_24h.toFixed(1)}%
                              </p>
                            )}
                            {monitor.avg_response_24h != null && (
                              <p className="text-[10px] text-muted-foreground">
                                {Math.round(monitor.avg_response_24h)}ms
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Recent Alerts */}
          {isLoading ? (
            <SidePanelSkeleton />
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  Recent Alerts
                </h2>
                <Link
                  href="/dashboard/alerts"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  View all alerts
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>

              {alertLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10">
                  <Bell className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No recent alerts
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
                  {alertLogs.map((log) => {
                    const projectColor = stringToColor(log.project_name);
                    return (
                      <div
                        key={log.id}
                        className="px-4 py-2.5 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <AlertStatusBadge status={log.status} />
                          <span className="text-[10px] text-muted-foreground uppercase font-medium">
                            {log.trigger_type.replace(/_/g, " ")}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {formatRelativeTime(log.created_at)}
                          </span>
                        </div>
                        <p className="text-xs truncate mb-1">{log.message}</p>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "px-1 py-0 rounded text-[9px] font-medium border",
                              projectColor
                            )}
                          >
                            {log.project_name}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {log.rule_name}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
