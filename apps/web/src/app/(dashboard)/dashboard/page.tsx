"use client";

import { memo, useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Users,
  TrendingUp,
  Zap,
  Check,
  ChevronRight,
  Activity,
  Clock,
  Flame,
  Search,
  Bookmark,
  Sparkles,
  X,
  Keyboard,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { issuesApi, type Issue, type Facets } from "@/lib/api";
import { ENVIRONMENT_COLORS } from "@/lib/search";
import { useProject } from "@/lib/project-context";
import { IssueSearchBar } from "@/components/search";
import { Sparkline, generateSparklineData } from "@/components/sparkline";
import { IssueListSkeleton } from "@/components/skeletons/issue-list-skeleton";
import { useListKeyboardNavigation } from "@/hooks/useListKeyboardNavigation";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import { toast } from "sonner";

const levelConfig = {
  fatal: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-l-red-500",
    badge: "bg-red-500/10 text-red-600 dark:text-red-400",
    glow: "hover:shadow-red-500/10",
    focusRing: "ring-red-500/40",
  },
  error: {
    icon: AlertCircle,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-l-orange-500",
    badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    glow: "hover:shadow-orange-500/10",
    focusRing: "ring-orange-500/40",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-l-yellow-500",
    badge: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    glow: "hover:shadow-yellow-500/0",
    focusRing: "ring-yellow-500/40",
  },
  info: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-l-blue-500",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    glow: "hover:shadow-blue-500/0",
    focusRing: "ring-blue-500/40",
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

type SortOption = "recent" | "frequent" | "users" | "trending";

interface IssueRowProps {
  issue: Issue;
  index: number;
  isHovered: boolean;
  isFocused: boolean;
  isSelected: boolean;
  isNew: boolean;
  sparkData: number[];
  density: "comfortable" | "compact";
  projectId: string | undefined;
  onHover: (id: string | null) => void;
  onFocus: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onResolve: (id: string) => void;
}

const IssueRow = memo(function IssueRow({
  issue,
  index,
  isHovered,
  isFocused,
  isSelected,
  isNew,
  sparkData,
  density,
  projectId,
  onHover,
  onFocus,
  onToggleSelect,
  onResolve,
}: IssueRowProps) {
  const config = levelConfig[issue.level as keyof typeof levelConfig] || levelConfig.error;
  const Icon = config.icon;
  const isRecent = Date.now() - new Date(issue.last_seen).getTime() < 1000 * 60 * 5;
  const isSevere = issue.level === "fatal" || issue.level === "error";

  return (
    <div
      data-issue-row
      className={`group relative flex items-center gap-4 rounded-lg border-l-4 ${config.border} bg-card transition-all duration-200
        ${isHovered && isSevere ? `shadow-lg ${config.glow}` : isHovered ? "shadow-md" : "hover:bg-muted/30"}
        ${isFocused ? `ring-2 ${config.focusRing}` : ""}
        ${isSelected ? "ring-2 ring-accent-2/30 bg-accent-2/5" : ""}
        ${issue.status === "resolved" ? "opacity-50" : ""}
        ${isNew ? "animate-slide-in-new" : ""}
      `}
      onMouseEnter={() => onHover(issue.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(index)}
    >
      <div className="pl-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(issue.id);
          }}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all
            ${isSelected ? "bg-accent-2 border-accent-2" : "border-muted-foreground/30 hover:border-accent-2/50"}
          `}
        >
          {isSelected && <Check className="h-3 w-3 text-accent-2-foreground" />}
        </button>
      </div>

      <Link
        href={`/dashboard/issues/${issue.id}?project=${projectId}`}
        className={`flex-1 flex items-center gap-4 pr-4 ${density === "compact" ? "py-2" : "py-3.5"}`}
      >
        <div className={`shrink-0 p-2 rounded-lg ${config.bg} transition-transform group-hover:scale-110`}>
          <Icon className={`h-4 w-4 ${config.color}`} aria-hidden="true" />
          <span className="sr-only">{issue.level} severity</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-[15px] tracking-tight truncate">{issue.title}</p>
            {issue.environment && issue.environment !== "production" && (
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  (ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.bg
                } ${(ENVIRONMENT_COLORS[issue.environment] ?? ENVIRONMENT_COLORS.production)!.text}`}
              >
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

        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <div
            className={`transition-opacity ${isHovered && issue.status !== "resolved" ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-auto"}`}
          >
            <Sparkline data={sparkData} width={56} height={16} showTrend={true} />
          </div>
          <span
            className={`text-xs text-muted-foreground text-right transition-opacity ${isHovered && issue.status !== "resolved" ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-16"}`}
          >
            {formatRelativeTime(issue.last_seen)}
          </span>
          {issue.status === "resolved" && (
            <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-medium uppercase">
              Resolved
            </span>
          )}
          {issue.status === "ignored" && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium uppercase">
              Ignored
            </span>
          )}
          {issue.status !== "resolved" && issue.status !== "ignored" && (
            <div
              className={`flex items-center gap-1 transition-all ${isHovered ? "opacity-100 w-auto" : "opacity-0 w-0 overflow-hidden"}`}
            >
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onResolve(issue.id);
                }}
              >
                <Check className="h-3 w-3 mr-1" />
                Resolve
              </Button>
            </div>
          )}
          {issue.status === "unresolved" && !isHovered && (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </Link>
    </div>
  );
});

// Built-in quick filters
const BUILT_IN_FILTERS = [
  { id: "critical", label: "Critical Issues", query: "level:fatal level:error", icon: Flame },
  { id: "trending", label: "Trending", query: "sort:trending", icon: TrendingUp },
  { id: "new-today", label: "New Today", query: "first_seen:today", icon: Sparkles },
];

export default function DashboardPage() {
  const router = useRouter();
  const { selectedProject, projects, isLoading: projectsLoading } = useProject();
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [searchResults, setSearchResults] = useState<Issue[] | null>(null);
  const [_facets, setFacets] = useState<Facets | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_isSearching, setIsSearching] = useState(false);
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isLive, setIsLive] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [newIssueIds, setNewIssueIds] = useState<Set<string>>(new Set());
  const previousIssueIdsRef = useRef<Set<string>>(new Set());

  // Saved searches
  const { savedSearches, saveSearch, deleteSearch } = useSavedSearches(selectedProject?.id);
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [currentSearchQuery, setCurrentSearchQuery] = useState("");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [renderCap, setRenderCap] = useState(100);
  const [density, setDensity] = useState<"compact" | "comfortable">(() => {
    if (typeof window === "undefined") return "comfortable";
    return (localStorage.getItem("bugwatch:issues-density") as "compact" | "comfortable") || "comfortable";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("bugwatch:issues-density", density);
    }
  }, [density]);

  // Restore filters from sessionStorage on mount
  useEffect(() => {
    if (!selectedProject) return;
    const key = `bugwatch:filters:${selectedProject.id}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.activeFilter) setActiveFilter(parsed.activeFilter);
        if (parsed.sortBy) setSortBy(parsed.sortBy);
      }
    } catch { /* ignore parse errors */ }
  }, [selectedProject]);

  // Save filters to sessionStorage when they change
  useEffect(() => {
    if (!selectedProject) return;
    const key = `bugwatch:filters:${selectedProject.id}`;
    sessionStorage.setItem(key, JSON.stringify({ activeFilter, sortBy }));
  }, [selectedProject, activeFilter, sortBy]);

  // Use search results if available, otherwise use all issues
  const displayIssues = useMemo(() => {
    const baseIssues = searchResults !== null ? searchResults : issues;
    const sorted = [...baseIssues].sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
        case "frequent":
          return b.count - a.count;
        case "users":
          return b.user_count - a.user_count;
        case "trending": {
          const aHours = (Date.now() - new Date(a.first_seen).getTime()) / (1000 * 60 * 60);
          const bHours = (Date.now() - new Date(b.first_seen).getTime()) / (1000 * 60 * 60);
          return (b.count / Math.max(bHours, 1)) - (a.count / Math.max(aHours, 1));
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [issues, searchResults, sortBy]);

  // Stats
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

  // Memoize sparkline data to avoid regeneration on every render (Math.random inside)
  const sparklineCache = useMemo(() => {
    const cache = new Map<string, number[]>();
    for (const issue of displayIssues) {
      cache.set(issue.id, generateSparklineData(issue.count, issue.first_seen));
    }
    return cache;
  }, [displayIssues]);

  // Store issue order in sessionStorage for prev/next navigation
  useEffect(() => {
    if (displayIssues.length > 0 && selectedProject) {
      const issueOrder = displayIssues.map(i => i.id);
      sessionStorage.setItem(`bugwatch:issue-order:${selectedProject.id}`, JSON.stringify(issueOrder));
    }
  }, [displayIssues, selectedProject]);

  // Keyboard navigation (j/k/Enter/x/r/m/e/? — full triage)
  const { focusedIndex, setFocusedIndex, containerRef } = useListKeyboardNavigation({
    itemCount: displayIssues.length,
    onOpen: (index) => {
      const issue = displayIssues[index];
      if (issue) {
        router.push(`/dashboard/issues/${issue.id}?project=${selectedProject?.id}`);
      }
    },
    onToggleSelect: (index) => {
      const issue = displayIssues[index];
      if (issue) toggleIssueSelection(issue.id);
    },
    onFocusSearch: () => {
      const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
      searchInput?.focus();
    },
    onResolve: (index) => {
      const issue = displayIssues[index];
      if (issue) void handleResolve(issue.id);
    },
    onIgnore: (index) => {
      const issue = displayIssues[index];
      if (issue) void handleIgnore(issue.id);
    },
    onShowHelp: () => setShowShortcutsHelp(true),
    isEnabled: !showSaveSearch,
  });

  // Search callbacks
  const handleSearchResults = useCallback((results: Issue[]) => {
    setSearchResults(results);
  }, []);
  const handleFacetsChange = useCallback((newFacets: Facets | null) => {
    setFacets(newFacets);
  }, []);
  const handleSearchLoading = useCallback((loading: boolean) => {
    setIsSearching(loading);
  }, []);
  const handleQueryChange = useCallback((query: string) => {
    setCurrentSearchQuery(query);
  }, []);

  // Fetch issues
  useEffect(() => {
    async function fetchIssues() {
      if (!selectedProject) {
        setIssues([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const issuesResponse = await issuesApi.list(selectedProject.id);
        setIssues(issuesResponse.data);
        previousIssueIdsRef.current = new Set(issuesResponse.data.map(i => i.id));
      } catch (err) {
        setError("Failed to load issues");
        toast.error("Failed to load issues", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      } finally {
        setIsLoading(false);
      }
    }
    fetchIssues();
  }, [selectedProject]);

  // Live polling (10s interval)
  useEffect(() => {
    if (!isLive || !selectedProject) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    async function pollIssues() {
      try {
        const response = await issuesApi.list(selectedProject!.id);
        const newIds = new Set(response.data.map(i => i.id));
        const addedIds = new Set<string>();

        for (const id of newIds) {
          if (!previousIssueIdsRef.current.has(id)) {
            addedIds.add(id);
          }
        }

        if (addedIds.size > 0) {
          setNewIssueIds(addedIds);
          // Clear animation class after animation completes
          setTimeout(() => setNewIssueIds(new Set()), 600);

          // Toast notification for new issues
          const newIssues = response.data.filter(i => addedIds.has(i.id));
          const hasCritical = newIssues.some(i => i.level === "fatal" || i.level === "error");
          if (hasCritical) {
            const critical = newIssues.find(i => i.level === "fatal" || i.level === "error");
            toast.error("New critical error", {
              description: critical?.title,
              action: critical ? {
                label: "View",
                onClick: () => router.push(`/dashboard/issues/${critical.id}?project=${selectedProject?.id}`),
              } : undefined,
            });
          } else {
            toast(`${addedIds.size} new issue${addedIds.size > 1 ? "s" : ""}` );
          }

          // Flash browser tab title
          const originalTitle = document.title;
          document.title = `(${addedIds.size}) Bugwatch`;
          const onFocus = () => { document.title = originalTitle; window.removeEventListener("focus", onFocus); };
          window.addEventListener("focus", onFocus);
        }

        previousIssueIdsRef.current = newIds;
        setIssues(response.data);
      } catch {
        // Silent fail for polling
      }
    }

    const POLL_INTERVAL_MS = 30000;

    function handleVisibility() {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        pollIssues();
        if (!interval) interval = setInterval(pollIssues, POLL_INTERVAL_MS);
      }
    }

    // Only start polling if the tab is actually visible on mount.
    if (!document.hidden) {
      interval = setInterval(pollIssues, POLL_INTERVAL_MS);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isLive, selectedProject]);

  const toggleIssueSelection = useCallback((id: string) => {
    setSelectedIssues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleHover = useCallback((id: string | null) => {
    setHoveredIssue(id);
  }, []);

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  // Ignore with undo (single)
  const handleIgnore = useCallback(async (issueId: string) => {
    if (!selectedProject) return;
    let previousStatus = "unresolved";

    setIssues(prev => {
      const issue = prev.find(i => i.id === issueId);
      if (issue) previousStatus = issue.status;
      return prev.map(i => i.id === issueId ? { ...i, status: "ignored" } : i);
    });

    toast.success("Issue ignored", {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: previousStatus } : i));
          try {
            await issuesApi.update(selectedProject.id, issueId, previousStatus);
          } catch {
            toast.error("Failed to undo ignore");
          }
        },
      },
    });

    try {
      await issuesApi.update(selectedProject.id, issueId, "ignored");
    } catch {
      setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: previousStatus } : i));
      toast.error("Failed to ignore issue");
    }
  }, [selectedProject]);

  // Resolve with undo
  const handleResolve = useCallback(async (issueId: string) => {
    if (!selectedProject) return;
    let previousStatus = "unresolved";

    setIssues(prev => {
      const issue = prev.find(i => i.id === issueId);
      if (issue) previousStatus = issue.status;
      return prev.map(i => i.id === issueId ? { ...i, status: "resolved" } : i);
    });

    toast.success("Issue resolved", {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: previousStatus } : i));
          try {
            await issuesApi.update(selectedProject.id, issueId, previousStatus);
          } catch {
            toast.error("Failed to undo resolve");
          }
        },
      },
    });

    try {
      await issuesApi.update(selectedProject.id, issueId, "resolved");
    } catch {
      setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: previousStatus } : i));
      toast.error("Failed to resolve issue");
    }
  }, [selectedProject]);

  // Bulk resolve with undo
  const handleBulkResolve = useCallback(async () => {
    if (!selectedProject || selectedIssues.size === 0) return;
    const ids = Array.from(selectedIssues);
    let previousStates = new Map<string, string>();

    setIssues(prev => {
      previousStates = new Map(
        prev.filter(i => ids.includes(i.id)).map(i => [i.id, i.status])
      );
      return prev.map(i => ids.includes(i.id) ? { ...i, status: "resolved" } : i);
    });
    setSelectedIssues(new Set());

    toast.success(`${ids.length} issues resolved`, {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssues(prev => prev.map(i => {
            const prev_status = previousStates.get(i.id);
            return prev_status ? { ...i, status: prev_status } : i;
          }));
          for (const id of ids) {
            const prevStatus = previousStates.get(id);
            if (prevStatus) {
              try { await issuesApi.update(selectedProject.id, id, prevStatus); } catch { /* */ }
            }
          }
        },
      },
    });

    for (const id of ids) {
      try { await issuesApi.update(selectedProject.id, id, "resolved"); } catch { /* */ }
    }
  }, [selectedProject, selectedIssues]);

  // Bulk ignore
  const handleBulkIgnore = useCallback(async () => {
    if (!selectedProject || selectedIssues.size === 0) return;
    const ids = Array.from(selectedIssues);
    let previousStates = new Map<string, string>();

    setIssues(prev => {
      previousStates = new Map(
        prev.filter(i => ids.includes(i.id)).map(i => [i.id, i.status])
      );
      return prev.map(i => ids.includes(i.id) ? { ...i, status: "ignored" } : i);
    });
    setSelectedIssues(new Set());

    toast.success(`${ids.length} issues ignored`, {
      action: {
        label: "Undo",
        onClick: async () => {
          setIssues(prev => prev.map(i => {
            const prev_status = previousStates.get(i.id);
            return prev_status ? { ...i, status: prev_status } : i;
          }));
          for (const id of ids) {
            const prevStatus = previousStates.get(id);
            if (prevStatus) {
              try { await issuesApi.update(selectedProject.id, id, prevStatus); } catch { /* */ }
            }
          }
        },
      },
    });

    for (const id of ids) {
      try { await issuesApi.update(selectedProject.id, id, "ignored"); } catch { /* */ }
    }
  }, [selectedProject, selectedIssues]);

  // Save search
  const handleSaveSearch = () => {
    if (!saveSearchName.trim()) return;
    saveSearch(saveSearchName.trim(), currentSearchQuery);
    toast.success("Search saved");
    setShowSaveSearch(false);
    setSaveSearchName("");
  };

  if (projectsLoading || isLoading) {
    return <IssueListSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-2/20 to-accent-2/5 flex items-center justify-center mb-6">
            <Bug className="h-8 w-8 text-accent-2" />
          </div>
          <h2 className="font-display text-heading-lg mb-2">No projects yet</h2>
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
          <h1 className="font-display text-heading-lg">Issues</h1>
          {selectedProject && (
            <span className="text-sm text-muted-foreground">
              {selectedProject.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Density toggle */}
          <div className="flex items-center rounded-lg border border-border-subtle bg-surface-2 p-0.5">
            <button
              type="button"
              onClick={() => setDensity("comfortable")}
              aria-label="Comfortable density"
              aria-pressed={density === "comfortable"}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                density === "comfortable"
                  ? "bg-accent-2/12 text-accent-2"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Comfortable
            </button>
            <button
              type="button"
              onClick={() => setDensity("compact")}
              aria-label="Compact density"
              aria-pressed={density === "compact"}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                density === "compact"
                  ? "bg-accent-2/12 text-accent-2"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Compact
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setShowShortcutsHelp(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setIsLive(!isLive)}
          >
            <Activity className="h-4 w-4 mr-2" />
            Live
            <span className={`ml-2 h-2 w-2 rounded-full transition-colors ${isLive ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"}`} />
          </Button>
        </div>
      </div>

      {/* Shortcuts help dialog */}
      <Dialog open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Navigate and triage issues without the mouse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-body-sm">
            {[
              { keys: ["j", "↓"], label: "Move focus down" },
              { keys: ["k", "↑"], label: "Move focus up" },
              { keys: ["Enter"], label: "Open issue" },
              { keys: ["x"], label: "Toggle select" },
              { keys: ["r"], label: "Resolve" },
              { keys: ["m", "e"], label: "Ignore" },
              { keys: ["/"], label: "Focus search" },
              { keys: ["?"], label: "Show this help" },
            ].map(({ keys, label }) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="flex items-center gap-1">
                  {keys.map((k) => (
                    <kbd
                      key={k}
                      className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border-subtle bg-surface-3 px-1.5 font-mono text-[11px] font-medium text-foreground"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-accent-2/5 hover:border-accent-2/20 card-hover">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Unresolved</p>
              <p className="font-display text-3xl font-semibold mt-1 tabular-nums tracking-tight">{stats.unresolved}</p>
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

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-accent-2/5 hover:border-accent-2/20 card-hover">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Events (24h)</p>
              <p className="font-display text-3xl font-semibold mt-1 tabular-nums tracking-tight">{stats.events.toLocaleString()}</p>
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

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-accent-2/5 hover:border-accent-2/20 card-hover">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Users Affected</p>
              <p className="font-display text-3xl font-semibold mt-1 tabular-nums tracking-tight">{stats.users.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Users className="h-5 w-5 text-purple-500" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-lg hover:shadow-accent-2/5 hover:border-accent-2/20 card-hover">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last 24h</p>
              <p className="font-display text-3xl font-semibold mt-1 tabular-nums tracking-tight">{stats.recentCount}</p>
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
        onQueryChange={handleQueryChange}
        sortBy={sortBy}
        onSortChange={(sort) => setSortBy(sort as SortOption)}
      />

      {/* Saved Searches Quick Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {BUILT_IN_FILTERS.map((filter) => {
          const FilterIcon = filter.icon;
          return (
            <button
              key={filter.id}
              onClick={() => {
                if (activeFilter === filter.id) {
                  setActiveFilter(null);
                  setSearchResults(null);
                  setSortBy("recent");
                } else {
                  setActiveFilter(filter.id);
                  if (filter.id === "trending") {
                    setSortBy("trending");
                  } else if (filter.id === "critical") {
                    // Filter to fatal + error level issues
                    setSearchResults(issues.filter(i => i.level === "fatal" || i.level === "error"));
                  } else if (filter.id === "new-today") {
                    // Filter to issues first seen today
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    setSearchResults(issues.filter(i => new Date(i.first_seen) >= today));
                  }
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${
                activeFilter === filter.id
                  ? "bg-accent-2 text-accent-2-foreground border-accent-2"
                  : "bg-card text-muted-foreground border-border hover:border-accent-2/30 hover:text-foreground"
              }`}
            >
              <FilterIcon className="h-3 w-3" />
              {filter.label}
            </button>
          );
        })}

        {savedSearches.length > 0 && (
          <div className="h-4 w-px bg-border mx-1 shrink-0" />
        )}

        {savedSearches.map((search) => (
          <button
            key={search.id}
            onClick={() => {
              if (activeFilter === search.id) {
                setActiveFilter(null);
                setSearchResults(null);
              } else {
                setActiveFilter(search.id);
                // Apply saved search query as a text filter
                if (search.query) {
                  const q = search.query.toLowerCase();
                  setSearchResults(issues.filter(i =>
                    i.title.toLowerCase().includes(q) ||
                    i.fingerprint.toLowerCase().includes(q) ||
                    (i.level && i.level.toLowerCase().includes(q))
                  ));
                }
              }
            }}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${
              activeFilter === search.id
                ? "bg-accent-2 text-accent-2-foreground border-accent-2"
                : "bg-card text-muted-foreground border-border hover:border-accent-2/30 hover:text-foreground"
            }`}
          >
            <Bookmark className="h-3 w-3" />
            {search.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteSearch(search.id);
                toast.success("Search removed");
              }}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </button>
        ))}

        {currentSearchQuery && (
          <button
            onClick={() => setShowSaveSearch(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border border-dashed border-accent-2/30 text-accent-2 hover:bg-accent-2/5 transition-all"
          >
            <Bookmark className="h-3 w-3" />
            Save Search
          </button>
        )}
      </div>

      {/* Save Search Mini Dialog */}
      {showSaveSearch && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card animate-fade-in-up">
          <Bookmark className="h-4 w-4 text-accent-2 shrink-0" />
          <input
            autoFocus
            type="text"
            value={saveSearchName}
            onChange={(e) => setSaveSearchName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveSearch(); if (e.key === "Escape") setShowSaveSearch(false); }}
            placeholder="Search name..."
            className="flex-1 h-7 bg-transparent text-sm outline-none"
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSaveSearch}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSaveSearch(false)}>Cancel</Button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIssues.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-accent-2/5 border border-accent-2/20 animate-fade-in-up">
          <span className="text-sm font-medium">{selectedIssues.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkResolve}>
              <Check className="h-3 w-3 mr-1" />
              Resolve All
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkIgnore}>
              Ignore All
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIssues(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <h3 className="text-lg font-medium mb-1">Something went wrong</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      )}

      {/* Issues List */}
      {!error && (
        <div className="space-y-1" ref={containerRef}>
          {displayIssues.length === 0 ? (
            searchResults !== null ? (
              // Empty with filters active
              <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Search className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-1">No matching issues</h3>
                <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or filters</p>
                <Button variant="outline" onClick={() => { setSearchResults(null); setActiveFilter(null); }}>
                  Clear filters
                </Button>
              </div>
            ) : (
              // Zero issues celebration
              <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/10 flex items-center justify-center mb-4">
                  <Check className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="text-lg font-medium mb-1">Zero issues!</h3>
                <p className="text-sm text-muted-foreground">Your application is running clean</p>
              </div>
            )
          ) : (
            displayIssues.slice(0, renderCap).map((issue, index) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                index={index}
                isHovered={hoveredIssue === issue.id}
                isFocused={focusedIndex === index}
                isSelected={selectedIssues.has(issue.id)}
                isNew={newIssueIds.has(issue.id)}
                sparkData={sparklineCache.get(issue.id) || []}
                density={density}
                projectId={selectedProject?.id}
                onHover={handleHover}
                onFocus={handleFocus}
                onToggleSelect={toggleIssueSelection}
                onResolve={handleResolve}
              />
            ))
          )}
        </div>
      )}

      {/* Load More */}
      {displayIssues.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-4">
          <p className="text-body-sm text-muted-foreground tabular-nums">
            Showing {Math.min(renderCap, displayIssues.length)} of {displayIssues.length} issues
          </p>
          {displayIssues.length > renderCap && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenderCap((n) => n + 100)}
            >
              Load 100 more
            </Button>
          )}
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pb-4">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">j</kbd>
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">k</kbd>
          navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">Enter</kbd>
          open
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">x</kbd>
          select
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">/</kbd>
          search
        </span>
      </div>
    </div>
  );
}
