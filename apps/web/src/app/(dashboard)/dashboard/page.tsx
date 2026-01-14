"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
  Clock,
  Flame,
} from "lucide-react";
import { issuesApi, type Issue, type Facets } from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { IssueSearchBar } from "@/components/search";

const levelConfig = {
  fatal: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-l-red-500",
    badge: "bg-red-500/10 text-red-600 dark:text-red-400",
    glow: "shadow-red-500/20"
  },
  error: {
    icon: AlertCircle,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-l-orange-500",
    badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    glow: "shadow-orange-500/20"
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-l-yellow-500",
    badge: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    glow: "shadow-yellow-500/20"
  },
  info: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-l-info-500",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    glow: "shadow-blue-500/20"
  },
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "-";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSec < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function generateTrendData(count: number, firstSeen: string): { trend: "up" | "down" | "stable"; percentage: number } {
  const hoursSinceFirst = (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60);
  if (hoursSinceFirst < 2) return { trend: "up", percentage: Math.min(500, Math.round(count * 10)) };
  if (hoursSinceFirst < 24) return { trend: "up", percentage: Math.round(50 + Math.random() * 150) };
  if (count > 100) return { trend: "stable", percentage: 0 };
  return { trend: "down", percentage: Math.round(10 + Math.random() * 30) };
}

type SortOption = "recent" | "frequent" | "users" | "trending";

export default function DashboardPage() {
  const { selectedProject, projects, isLoading: projectsLoading } = useProject();
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [searchResults, setSearchResults] = useState<Issue[] | null>(null);
  const [_facets, setFacets] = useState<Facets | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_isSearching, setIsSearching] = useState(false);
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());

  // Use search results if available, otherwise use all issues
  const displayIssues = useMemo(() => {
    const baseIssues = searchResults !== null ? searchResults : issues;

    // Sort (client-side for now, server-side sort coming from search)
    const sorted = [...baseIssues].sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
        case "frequent":
          return b.count - a.count;
        case "users":
          return b.user_count - a.user_count;
        case "trending":
          const aTrend = generateTrendData(a.count, a.first_seen);
          const bTrend = generateTrendData(b.count, b.first_seen);
          return bTrend.percentage - aTrend.percentage;
        default:
          return 0;
      }
    });

    return sorted;
  }, [issues, searchResults, sortBy]);

  // Stats - calculated from displayIssues to match what's shown
  const stats = useMemo(() => {
    const unresolved = displayIssues.filter(i => i.status === "unresolved");
    const recentIssues = displayIssues.filter(i => {
      const hoursSince = (Date.now() - new Date(i.last_seen).getTime()) / (1000 * 60 * 60);
      return hoursSince < 24;
    });
    return {
      total: displayIssues.length,
      unresolved: unresolved.length,
      events: displayIssues.reduce((sum, i) => sum + i.count, 0),
      users: displayIssues.reduce((sum, i) => sum + i.user_count, 0),
      recentCount: recentIssues.length,
      criticalCount: displayIssues.filter(i => i.level === "fatal" || i.level === "error").length,
    };
  }, [displayIssues]);

  // Handlers for search bar callbacks
  const handleSearchResults = useCallback((results: Issue[]) => {
    setSearchResults(results);
  }, []);

  const handleFacetsChange = useCallback((newFacets: Facets | null) => {
    setFacets(newFacets);
  }, []);

  const handleSearchLoading = useCallback((loading: boolean) => {
    setIsSearching(loading);
  }, []);

  // Fetch initial issues when selected project changes
  useEffect(() => {
    async function fetchIssues() {
      if (!selectedProject) {
        setIssues([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const issuesResponse = await issuesApi.list(selectedProject.id);
        setIssues(issuesResponse.data);
      } catch (err) {
        console.error("Failed to fetch issues:", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchIssues();
  }, [selectedProject]);

  const toggleIssueSelection = (id: string) => {
    const newSelected = new Set(selectedIssues);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIssues(newSelected);
  };

  if (projectsLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Loading issues...</p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6">
            <Bug className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first project to start tracking errors in your application.
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
      {/* Compact Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">Issues</h1>
          {selectedProject && (
            <span className="text-sm text-muted-foreground">
              {selectedProject.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Activity className="h-4 w-4 mr-2" />
            Live
            <span className="ml-2 h-2 w-2 rounded-full bg-bug animate-pulse" />
          </Button>
        </div>
      </div>

      {/* Stats Row - Compact, Modern */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Unresolved</p>
              <p className="text-2xl font-bold mt-1">{stats.unresolved}</p>
            </div>
            <div className={`p-2 rounded-lg ${stats.unresolved > 0 ? 'bg-orange-500/10' : 'bg-bug/10'}`}>
              <AlertCircle className={`h-5 w-5 ${stats.unresolved > 0 ? 'text-orange-500' : 'text-bug'}`} />
            </div>
          </div>
          {stats.criticalCount > 0 && (
            <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {stats.criticalCount} critical
            </p>
          )}
        </div>

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Events (24h)</p>
              <p className="text-2xl font-bold mt-1">{stats.events.toLocaleString()}</p>
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

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Users Affected</p>
              <p className="text-2xl font-bold mt-1">{stats.users.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Users className="h-5 w-5 text-purple-500" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last 24h</p>
              <p className="text-2xl font-bold mt-1">{stats.recentCount}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Clock className="h-5 w-5 text-emerald-500" />
            </div>
          </div>
          {stats.recentCount > 0 && (
            <p className="text-xs text-emerald-500 mt-2">Active issues</p>
          )}
        </div>
      </div>

      {/* Advanced Search Bar */}
      <IssueSearchBar
        projectId={selectedProject?.id}
        onResultsChange={handleSearchResults}
        onFacetsChange={handleFacetsChange}
        onLoadingChange={handleSearchLoading}
        sortBy={sortBy}
        onSortChange={(sort) => setSortBy(sort as SortOption)}
      />

      {/* Bulk Actions Bar */}
      {selectedIssues.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20 animate-in slide-in-from-top-2">
          <span className="text-sm font-medium">{selectedIssues.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Check className="h-3 w-3 mr-1" />
              Resolve All
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              Ignore All
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIssues(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Issues List - Clean, Modern */}
      <div className="space-y-1">
        {displayIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bug/20 to-bug/5 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-bug" />
            </div>
            <h3 className="text-lg font-medium mb-1">All clear!</h3>
            <p className="text-sm text-muted-foreground">No issues match your filters</p>
          </div>
        ) : (
          displayIssues.map((issue) => {
            const config = levelConfig[issue.level as keyof typeof levelConfig] || levelConfig.error;
            const Icon = config.icon;
            const isHovered = hoveredIssue === issue.id;
            const isSelected = selectedIssues.has(issue.id);
            const trend = generateTrendData(issue.count, issue.first_seen);
            const isRecent = (Date.now() - new Date(issue.last_seen).getTime()) < 1000 * 60 * 5; // 5 min

            return (
              <div
                key={issue.id}
                className={`group relative flex items-center gap-4 rounded-lg border-l-4 ${config.border} bg-card transition-all duration-200
                  ${isHovered ? 'shadow-lg scale-[1.01] z-10' : 'hover:bg-muted/30'}
                  ${isSelected ? 'ring-2 ring-primary/30 bg-primary/5' : ''}
                  ${issue.status === "resolved" ? "opacity-50" : ""}
                `}
                onMouseEnter={() => setHoveredIssue(issue.id)}
                onMouseLeave={() => setHoveredIssue(null)}
              >
                {/* Selection Checkbox */}
                <div className="pl-3">
                  <button
                    onClick={() => toggleIssueSelection(issue.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all
                      ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30 hover:border-primary/50'}
                    `}
                  >
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </button>
                </div>

                {/* Main Content - Clickable */}
                <Link
                  href={`/dashboard/issues/${issue.id}?project=${selectedProject?.id}`}
                  className="flex-1 flex items-center gap-4 py-3 pr-4"
                >
                  {/* Icon */}
                  <div className={`shrink-0 p-2 rounded-lg ${config.bg} transition-transform group-hover:scale-110`}>
                    <Icon className={`h-4 w-4 ${config.color}`} />
                  </div>

                  {/* Title & Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{issue.title}</p>
                      {isRecent && (
                        <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-bug/10 text-bug text-[10px] font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-bug animate-pulse" />
                          NEW
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{issue.fingerprint.slice(0, 8)}</span>
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {issue.count.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {issue.user_count}
                      </span>
                    </div>
                  </div>

                  {/* Trend & Time & Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Trend Indicator - hide on hover when showing actions */}
                    <div className={`flex items-center gap-1 text-xs font-medium transition-opacity ${isHovered && issue.status !== "resolved" ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto'}
                      ${trend.trend === 'up' ? 'text-red-500' : trend.trend === 'down' ? 'text-accent' : 'text-muted-foreground'}
                    `}>
                      {trend.trend === 'up' ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : trend.trend === 'down' ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : null}
                      {trend.percentage > 0 && (
                        <span>{trend.trend === 'up' ? '+' : '-'}{trend.percentage}%</span>
                      )}
                    </div>

                    {/* Time - hide on hover when showing actions */}
                    <span className={`text-xs text-muted-foreground text-right transition-opacity ${isHovered && issue.status !== "resolved" ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-16'}`}>
                      {formatRelativeTime(issue.last_seen)}
                    </span>

                    {/* Status Badge */}
                    {issue.status === "resolved" && (
                      <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-medium uppercase">
                        Resolved
                      </span>
                    )}

                    {/* Quick Actions - show on hover */}
                    {issue.status !== "resolved" && (
                      <div className={`flex items-center gap-1 transition-all ${isHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'}`}>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Resolve
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {/* Chevron when not hovered and not resolved */}
                    {issue.status !== "resolved" && !isHovered && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </Link>
              </div>
            );
          })
        )}
      </div>

      {/* Load More */}
      {displayIssues.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" className="text-muted-foreground">
            Load more issues
          </Button>
        </div>
      )}
    </div>
  );
}
