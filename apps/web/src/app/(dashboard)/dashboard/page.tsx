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
  Flame,
  Search,
  Bookmark,
  Sparkles,
  X,
  Keyboard,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { issuesApi, ApiError, type Issue, type Facets } from "@/lib/api";
import { ENVIRONMENT_COLORS } from "@/lib/search";
import { useProject } from "@/lib/project-context";
import { IssueSearchBar } from "@/components/search";
import { Sparkline, generateSparklineData } from "@/components/sparkline";
import { IssueListSkeleton } from "@/components/skeletons/issue-list-skeleton";
import { useListKeyboardNavigation } from "@/hooks/useListKeyboardNavigation";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "sonner";
import { OnboardingEmptyState } from "@/components/onboarding/OnboardingEmptyState";
import { FirstErrorCelebration } from "@/components/onboarding/FirstErrorCelebration";
import { useFirstError } from "@/hooks/useFirstError";

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

  return (
    <div
      data-issue-row
      className={`group relative flex items-center gap-4 rounded-lg border-l-4 ${config.border} bg-[hsl(var(--surface-1))] border border-[hsl(var(--border-subtle))] transition-all duration-150
        ${isHovered ? "bg-[hsl(var(--surface-2))] border-[hsl(var(--border-strong))]" : ""}
        ${isFocused ? `ring-2 ${config.focusRing}` : ""}
        ${isSelected ? "ring-1 ring-[hsl(var(--accent))]/30 bg-[hsl(var(--accent))]/5" : ""}
        ${issue.status === "resolved" ? "opacity-50" : ""}
        ${isNew ? "animate-slide-in-new new-issue-glow" : ""}
      `}
      onMouseEnter={() => onHover(issue.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(index)}
    >
      <div className="pl-3">
        <button
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select issue: ${issue.title}`}
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
        className={`flex-1 flex items-center gap-4 pr-4 ${density === "compact" ? "py-3" : "py-4"}`}
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
              <span
                className="shrink-0 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))] animate-pulse"
                aria-label="New issue"
              />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            <span className="font-mono text-[11px]">{issue.fingerprint.slice(0, 8)}</span>
            <span className="flex items-center gap-1 font-mono">
              <Activity className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Events: </span>
              {issue.count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 font-mono">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Users affected: </span>
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
            className={`text-xs text-[hsl(var(--muted-foreground))] font-mono text-right transition-opacity ${isHovered && issue.status !== "resolved" ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-16"}`}
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
              className={`flex items-center gap-1 transition-all ${isHovered ? "opacity-100" : "opacity-0 focus-within:opacity-100"}`}
            >
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Resolve: ${issue.title}`}
                className="h-7 px-2 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onResolve(issue.id);
                }}
              >
                <Check className="h-3 w-3 mr-1" aria-hidden="true" />
                Resolve
              </Button>
            </div>
          )}
          {issue.status === "unresolved" && !isHovered && (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_facets, setFacets] = useState<Facets | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isSearching, setIsSearching] = useState(false);
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isLive, setIsLive] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [newIssueIds, setNewIssueIds] = useState<Set<string>>(new Set());
  const previousIssueIdsRef = useRef<Set<string>>(new Set());

  // First-error celebration
  const { firstIssue, shouldCelebrate, dismiss } = useFirstError();

  // Saved searches
  const { savedSearches, saveSearch, deleteSearch } = useSavedSearches(selectedProject?.id);
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [currentSearchQuery, setCurrentSearchQuery] = useState("");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [renderCap, setRenderCap] = useState(100);
  const [density, setDensity] = useState<"compact" | "comfortable">(() => {
    if (typeof window === "undefined") return "comfortable";
    const stored = localStorage.getItem("bugwatch:issues-density");
    return stored === "compact" || stored === "comfortable" ? stored : "comfortable";
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
        if (parsed.activeFilter && typeof parsed.activeFilter === "string") setActiveFilter(parsed.activeFilter);
        const VALID_SORT = new Set(["recent", "frequent", "users", "trending"]);
        if (parsed.sortBy && VALID_SORT.has(parsed.sortBy)) setSortBy(parsed.sortBy as SortOption);
      }
    } catch {
      /* ignore parse errors */
    }
  }, [selectedProject]);

  // Save filters to sessionStorage when they change
  useEffect(() => {
    if (!selectedProject) return;
    const key = `bugwatch:filters:${selectedProject.id}`;
    sessionStorage.setItem(key, JSON.stringify({ activeFilter, sortBy }));
  }, [selectedProject, activeFilter, sortBy]);

  // Pre-compute timestamps once, then sort with numeric comparison only.
  // Avoids O(n log n × Date) — drops to O(n) precompute + O(n log n) numeric.
  const displayIssues = useMemo(() => {
    const baseIssues = searchResults !== null ? searchResults : issues;
    const now = Date.now();
    const withTs = baseIssues.map((i) => ({
      ...i,
      _lastMs: new Date(i.last_seen).getTime(),
      _firstMs: new Date(i.first_seen).getTime(),
    }));
    withTs.sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return b._lastMs - a._lastMs;
        case "frequent":
          return b.count - a.count;
        case "users":
          return b.user_count - a.user_count;
        case "trending": {
          const aH = (now - a._firstMs) / 3600000;
          const bH = (now - b._firstMs) / 3600000;
          return b.count / Math.max(bH, 1) - a.count / Math.max(aH, 1);
        }
        default:
          return 0;
      }
    });
    return withTs;
  }, [issues, searchResults, sortBy]);

  // Stats — single pass, memoized on `issues` (not displayIssues — sort order doesn't affect counts)
  const stats = useMemo(() => {
    let unresolved = 0,
      events = 0,
      users = 0,
      recent = 0,
      critical = 0,
      fatal = 0,
      error = 0;
    const now = Date.now();
    for (const i of issues) {
      if (i.status === "unresolved") unresolved++;
      events += i.count;
      users += i.user_count;
      if (now - new Date(i.last_seen).getTime() < 86400000) recent++;
      if (i.level === "fatal") {
        fatal++;
        critical++;
      } else if (i.level === "error") {
        error++;
        critical++;
      }
    }
    return {
      total: issues.length,
      unresolved,
      events,
      users,
      recentCount: recent,
      criticalCount: critical,
      fatalCount: fatal,
      errorCount: error,
    };
  }, [issues]);

  // Sparkline cache — keyed by id:count so re-sorts don't regenerate
  const sparklineCacheRef = useRef(new Map<string, number[]>());
  const sparklineCache = useMemo(() => {
    const cache = sparklineCacheRef.current;
    // Build set of current keys for cleanup
    const currentKeys = new Set<string>();
    for (const issue of issues) {
      const key = `${issue.id}:${issue.count}`;
      currentKeys.add(key);
      if (!cache.has(key)) {
        cache.set(key, generateSparklineData(issue.count, issue.first_seen));
      }
    }
    // Evict stale entries to prevent unbounded growth
    for (const k of cache.keys()) {
      if (!currentKeys.has(k)) cache.delete(k);
    }
    return cache;
  }, [issues]);

  // Store issue order in sessionStorage for prev/next navigation
  useEffect(() => {
    if (displayIssues.length > 0 && selectedProject) {
      const issueOrder = displayIssues.map((i) => i.id);
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
      const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]");
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

  // Fetch issues — abort controller cancels any in-flight request on project switch
  useEffect(() => {
    const controller = new AbortController();

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
        if (controller.signal.aborted) return;
        setIssues(issuesResponse.data);
        previousIssueIdsRef.current = new Set(issuesResponse.data.map((i) => i.id));
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError("Failed to load issues");
        toast.error("Failed to load issues", {
          description: "Please try again",
        });
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    fetchIssues();
    return () => controller.abort();
  }, [selectedProject]);

  // Live polling (30s interval)
  useEffect(() => {
    if (!isLive || !selectedProject) return;

    let cancelled = false;
    let polling = false; // prevent overlapping concurrent polls
    let interval: ReturnType<typeof setInterval> | null = null;
    let titleFocusHandler: (() => void) | null = null;
    let clearNewIdsTimer: ReturnType<typeof setTimeout> | null = null;

    async function pollIssues() {
      if (polling || cancelled) return;
      polling = true;
      try {
        const response = await issuesApi.list(selectedProject!.id);
        if (cancelled) return;

        const newIds = new Set(response.data.map((i) => i.id));
        const addedIds = new Set<string>();

        for (const id of newIds) {
          if (!previousIssueIdsRef.current.has(id)) {
            addedIds.add(id);
          }
        }

        if (addedIds.size > 0) {
          setNewIssueIds(addedIds);
          if (clearNewIdsTimer) clearTimeout(clearNewIdsTimer);
          clearNewIdsTimer = setTimeout(() => setNewIssueIds(new Set()), 600);

          const newIssues = response.data.filter((i) => addedIds.has(i.id));
          const hasCritical = newIssues.some((i) => i.level === "fatal" || i.level === "error");
          if (hasCritical) {
            const critical = newIssues.find((i) => i.level === "fatal" || i.level === "error");
            toast.error("New critical error", {
              description: critical?.title,
              action: critical
                ? {
                    label: "View",
                    onClick: () => router.push(`/dashboard/issues/${critical.id}?project=${selectedProject?.id}`),
                  }
                : undefined,
            });
          } else {
            toast(`${addedIds.size} new issue${addedIds.size > 1 ? "s" : ""}`);
          }

          // Flash browser tab title — use { once: true } to prevent listener accumulation
          const originalTitle = document.title;
          document.title = `(${addedIds.size}) Bugwatch`;
          if (titleFocusHandler) window.removeEventListener("focus", titleFocusHandler);
          titleFocusHandler = () => {
            document.title = originalTitle;
          };
          window.addEventListener("focus", titleFocusHandler, { once: true });
        }

        previousIssueIdsRef.current = newIds;
        setIssues(response.data);
      } catch {
        // Silent fail for polling
      } finally {
        polling = false;
      }
    }

    const POLL_INTERVAL_MS = 30000;

    function handleVisibility() {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } else {
        pollIssues();
        if (!interval) interval = setInterval(pollIssues, POLL_INTERVAL_MS);
      }
    }

    if (!document.hidden) {
      // Poll immediately on activation, then on the regular interval
      pollIssues();
      interval = setInterval(pollIssues, POLL_INTERVAL_MS);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (clearNewIdsTimer) clearTimeout(clearNewIdsTimer);
      if (titleFocusHandler) window.removeEventListener("focus", titleFocusHandler);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isLive, selectedProject]);

  const toggleIssueSelection = useCallback((id: string) => {
    setSelectedIssues((prev) => {
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

  // Single issue status change with optimistic update + undo
  // verb = action verb ("resolve", "ignore"); label = past tense ("resolved", "ignored")
  const handleStatusChange = useCallback(
    async (issueId: string, newStatus: string, verb: string, label: string) => {
      if (!selectedProject) return;
      // Capture previousStatus atomically inside the updater to avoid stale closure.
      let previousStatus = "unresolved";
      setIssues((prev) => {
        previousStatus = prev.find((i) => i.id === issueId)?.status ?? "unresolved";
        return prev.map((i) => (i.id === issueId ? { ...i, status: newStatus } : i));
      });

      toast.success(`Issue ${label}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status: previousStatus } : i)));
            try {
              await issuesApi.update(selectedProject.id, issueId, previousStatus);
            } catch {
              toast.error(`Failed to undo ${label}`);
            }
          },
        },
      });

      try {
        await issuesApi.update(selectedProject.id, issueId, newStatus);
      } catch {
        setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status: previousStatus } : i)));
        toast.error(`Failed to ${verb} issue`);
      }
    },
    [selectedProject]
  );

  const handleIgnore = useCallback(
    (issueId: string) => handleStatusChange(issueId, "ignored", "ignore", "ignored"),
    [handleStatusChange]
  );
  const handleResolve = useCallback(
    (issueId: string) => handleStatusChange(issueId, "resolved", "resolve", "resolved"),
    [handleStatusChange]
  );

  // Bulk status change with optimistic update + undo
  const handleBulkStatusChange = useCallback(
    async (newStatus: string, label: string) => {
      if (!selectedProject || selectedIssues.size === 0) return;
      const ids = Array.from(selectedIssues);
      const idSet = new Set(ids);

      // Capture previousStates atomically inside the updater to avoid stale closure.
      let previousStates = new Map<string, string>();
      setIssues((prev) => {
        previousStates = new Map(prev.filter((i) => idSet.has(i.id)).map((i) => [i.id, i.status]));
        return prev.map((i) => (idSet.has(i.id) ? { ...i, status: newStatus } : i));
      });
      setSelectedIssues(new Set());

      toast.success(`${ids.length} issues ${label}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            setIssues((prev) =>
              prev.map((i) => {
                const prevStatus = previousStates.get(i.id);
                return prevStatus ? { ...i, status: prevStatus } : i;
              })
            );
            await Promise.allSettled(
              ids.map((id) => {
                const prevStatus = previousStates.get(id);
                return prevStatus ? issuesApi.update(selectedProject.id, id, prevStatus) : Promise.resolve();
              })
            );
          },
        },
      });

      // Run all status updates in parallel rather than sequentially.
      await Promise.allSettled(ids.map((id) => issuesApi.update(selectedProject.id, id, newStatus)));
    },
    [selectedProject, selectedIssues]
  );

  const handleBulkResolve = useCallback(() => handleBulkStatusChange("resolved", "resolved"), [handleBulkStatusChange]);
  const handleBulkIgnore = useCallback(() => handleBulkStatusChange("ignored", "ignored"), [handleBulkStatusChange]);

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
      {/* First-error celebration overlay */}
      {shouldCelebrate && firstIssue && <FirstErrorCelebration issue={firstIssue} onDismiss={dismiss} />}

      {/* Compact Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-heading-lg">Issues</h1>
          {selectedProject && <span className="text-sm text-muted-foreground">{selectedProject.name}</span>}
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
                density === "compact" ? "bg-accent-2/12 text-accent-2" : "text-muted-foreground hover:text-foreground"
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
            role="switch"
            aria-checked={isLive}
            aria-label={isLive ? "Disable live updates" : "Enable live updates"}
            className="text-muted-foreground"
            onClick={() => setIsLive(!isLive)}
          >
            <Activity className="h-4 w-4 mr-2" aria-hidden="true" />
            Live
            <span
              aria-hidden="true"
              className={`ml-2 h-2 w-2 rounded-full transition-colors ${isLive ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"}`}
            />
          </Button>
        </div>
      </div>

      {/* Shortcuts help dialog */}
      <Dialog open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Navigate and triage issues without the mouse.</DialogDescription>
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

      {/* Triage Bar */}
      <div className="flex items-center gap-3 h-10 px-4 rounded-lg surface-card border-[hsl(var(--border-subtle))]">
        <button
          type="button"
          onClick={() => {
            setActiveFilter(activeFilter === "fatal-triage" ? null : "fatal-triage");
            setSearchResults(activeFilter === "fatal-triage" ? null : issues.filter((i) => i.level === "fatal"));
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold transition-all ${
            stats.criticalCount > 0 ? "text-red-400 hover:bg-red-500/10" : "text-[hsl(var(--muted-foreground))]"
          } ${activeFilter === "fatal-triage" ? "bg-red-500/10" : ""}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${stats.criticalCount > 0 ? "bg-red-500 animate-pulse" : "bg-[hsl(var(--muted-foreground))]"}`}
          />
          {stats.fatalCount} FATAL
        </button>
        <div className="h-4 w-px bg-[hsl(var(--border-subtle))]" />
        <button
          type="button"
          onClick={() => {
            setActiveFilter(activeFilter === "error-triage" ? null : "error-triage");
            setSearchResults(activeFilter === "error-triage" ? null : issues.filter((i) => i.level === "error"));
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold transition-all ${
            stats.errorCount > 0 ? "text-orange-400 hover:bg-orange-500/10" : "text-[hsl(var(--muted-foreground))]"
          } ${activeFilter === "error-triage" ? "bg-orange-500/10" : ""}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${stats.errorCount > 0 ? "bg-orange-500" : "bg-[hsl(var(--muted-foreground))]"}`}
          />
          {stats.errorCount} ERROR
        </button>
        <div className="h-4 w-px bg-[hsl(var(--border-subtle))]" />
        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{stats.unresolved} unresolved</span>
        <div className="flex-1" />
        {selectedIssues.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
              {selectedIssues.size} selected
            </span>
            <button
              type="button"
              onClick={handleBulkResolve}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/20 transition-colors"
            >
              <Check className="h-3 w-3" />
              Resolve all
            </button>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="surface-card p-4 card-hover">
          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Unresolved
          </p>
          <p className="font-mono text-3xl font-bold mt-1 tabular-nums tracking-tight">{stats.unresolved}</p>
          {stats.criticalCount > 0 && (
            <p className="text-xs text-red-400 mt-2 flex items-center gap-1 font-mono">
              <Flame className="h-3 w-3" />
              {stats.criticalCount} critical
            </p>
          )}
        </div>

        <div className="surface-card p-4 card-hover">
          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Events</p>
          <p className="font-mono text-3xl font-bold mt-1 tabular-nums tracking-tight">
            {stats.events.toLocaleString()}
          </p>
          <div className="mt-2 h-0.5 rounded-full bg-[hsl(var(--surface-3))] overflow-hidden">
            <div className="h-full w-3/4 bg-[hsl(var(--accent))]/40 rounded-full" />
          </div>
        </div>

        <div className="surface-card p-4 card-hover">
          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Users Affected
          </p>
          <p className="font-mono text-3xl font-bold mt-1 tabular-nums tracking-tight">
            {stats.users.toLocaleString()}
          </p>
        </div>

        <div className="surface-card p-4 card-hover">
          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Last 24h
          </p>
          <p className="font-mono text-3xl font-bold mt-1 tabular-nums tracking-tight">{stats.recentCount}</p>
          {stats.recentCount > 0 && <p className="text-xs text-emerald-400 mt-2 font-mono">Active</p>}
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
              type="button"
              aria-pressed={activeFilter === filter.id}
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
                    setSearchResults(issues.filter((i) => i.level === "fatal" || i.level === "error"));
                  } else if (filter.id === "new-today") {
                    // Filter to issues first seen today
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    setSearchResults(issues.filter((i) => new Date(i.first_seen) >= today));
                  }
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${
                activeFilter === filter.id
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] border-[hsl(var(--accent))]"
                  : "bg-[hsl(var(--surface-1))] text-muted-foreground border-border hover:border-[hsl(var(--accent))]/30 hover:text-foreground"
              }`}
            >
              <FilterIcon className="h-3 w-3" />
              {filter.label}
            </button>
          );
        })}

        {savedSearches.length > 0 && <div className="h-4 w-px bg-border mx-1 shrink-0" />}

        {savedSearches.map((search) => (
          // Using div+role="button" to avoid nested <button> elements (invalid HTML)
          <div
            key={search.id}
            role="button"
            tabIndex={0}
            aria-pressed={activeFilter === search.id}
            aria-label={`Filter by saved search: ${search.name}`}
            onClick={() => {
              if (activeFilter === search.id) {
                setActiveFilter(null);
                setSearchResults(null);
              } else {
                setActiveFilter(search.id);
                if (search.query) {
                  const q = search.query.toLowerCase();
                  setSearchResults(
                    issues.filter(
                      (i) =>
                        i.title.toLowerCase().includes(q) ||
                        i.fingerprint.toLowerCase().includes(q) ||
                        (i.level && i.level.toLowerCase().includes(q))
                    )
                  );
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
            }}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all cursor-pointer ${
              activeFilter === search.id
                ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] border-[hsl(var(--accent))]"
                : "bg-[hsl(var(--surface-1))] text-muted-foreground border-border hover:border-[hsl(var(--accent))]/30 hover:text-foreground"
            }`}
          >
            <Bookmark className="h-3 w-3" aria-hidden="true" />
            {search.name}
            <button
              type="button"
              aria-label={`Remove saved search: ${search.name}`}
              onClick={(e) => {
                e.stopPropagation();
                deleteSearch(search.id);
                toast.success("Search removed");
              }}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
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
        <div className="flex items-center gap-2 px-3 py-2 surface-card animate-fade-in-up">
          <Bookmark className="h-4 w-4 text-accent-2 shrink-0" />
          <input
            autoFocus
            type="text"
            aria-label="Search name"
            value={saveSearchName}
            onChange={(e) => setSaveSearchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveSearch();
              if (e.key === "Escape") setShowSaveSearch(false);
            }}
            placeholder="Search name..."
            className="flex-1 h-7 bg-transparent text-sm outline-none"
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSaveSearch}>
            Save
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSaveSearch(false)}>
            Cancel
          </Button>
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchResults(null);
                    setActiveFilter(null);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              // Zero issues — onboarding empty state
              <OnboardingEmptyState project={selectedProject} />
            )
          ) : (
            displayIssues
              .slice(0, renderCap)
              .map((issue, index) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  index={index}
                  isHovered={hoveredIssue === issue.id}
                  isFocused={focusedIndex === index}
                  isSelected={selectedIssues.has(issue.id)}
                  isNew={newIssueIds.has(issue.id)}
                  sparkData={sparklineCache.get(`${issue.id}:${issue.count}`) || []}
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
            <Button variant="outline" size="sm" onClick={() => setRenderCap((n) => n + 100)}>
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
