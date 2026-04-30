'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProject } from '@/lib/project-context';
import { useFeature } from '@/hooks/use-feature';
import { PaywallModal } from '@/components/paywall-modal';
import { LogVolumeChart } from '@/components/logs/LogVolumeChart';
import { LogTable } from '@/components/logs/LogTable';
import { LogFacetSidebar } from '@/components/logs/LogFacetSidebar';
import { LogTailPanel } from '@/components/logs/LogTailPanel';
import { SavedSearchBar } from '@/components/logs/SavedSearchBar';
import { AlertRulesModal } from '@/components/logs/AlertRulesModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { logsApi, type LogListParams } from '@/lib/api';
import { toast } from 'sonner';
import { ScrollText, Bell, Radio, ChevronLeft, ChevronRight, Search } from 'lucide-react';

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000); // 1 hour ago
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

const TIME_RANGE_OPTIONS = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
  { label: '7d', minutes: 10080 },
];

export default function LogsPage() {
  const { selectedProject } = useProject();
  const hasLogs = useFeature('log_monitoring');
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<LogListParams>({ page: 1, per_page: 50 });
  const [timeRange, setTimeRange] = useState(getDefaultTimeRange);
  const [selectedTimeLabel, setSelectedTimeLabel] = useState('1h');
  const [isTailing, setIsTailing] = useState(false);
  const [isAlertRulesOpen, setAlertRulesOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const projectId = selectedProject?.id ?? '';

  // ── Paywall gate ────────────────────────────────────────────────────────────
  if (!hasLogs) {
    return (
      <div className="flex items-center justify-center h-full">
        <PaywallModal />
      </div>
    );
  }

  // ── No project selected ─────────────────────────────────────────────────────
  if (!selectedProject) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-heading-lg flex items-center gap-2">
            <ScrollText className="h-6 w-6" />
            Log Monitoring
          </h1>
          <p className="text-muted-foreground mt-1">Select a project to view logs.</p>
        </div>
      </div>
    );
  }

  return (
    <LogsPageInner
      projectId={projectId}
      filters={filters}
      setFilters={setFilters}
      timeRange={timeRange}
      setTimeRange={setTimeRange}
      selectedTimeLabel={selectedTimeLabel}
      setSelectedTimeLabel={setSelectedTimeLabel}
      isTailing={isTailing}
      setIsTailing={setIsTailing}
      isAlertRulesOpen={isAlertRulesOpen}
      setAlertRulesOpen={setAlertRulesOpen}
      searchInput={searchInput}
      setSearchInput={setSearchInput}
      queryClient={queryClient}
    />
  );
}

// Inner component — avoids calling hooks conditionally while separating paywall/no-project states
function LogsPageInner({
  projectId,
  filters,
  setFilters,
  timeRange,
  setTimeRange,
  selectedTimeLabel,
  setSelectedTimeLabel,
  isTailing,
  setIsTailing,
  isAlertRulesOpen,
  setAlertRulesOpen,
  searchInput,
  setSearchInput,
  queryClient,
}: {
  projectId: string;
  filters: LogListParams;
  setFilters: (f: LogListParams) => void;
  timeRange: { start: string; end: string };
  setTimeRange: (t: { start: string; end: string }) => void;
  selectedTimeLabel: string;
  setSelectedTimeLabel: (l: string) => void;
  isTailing: boolean;
  setIsTailing: (v: boolean) => void;
  isAlertRulesOpen: boolean;
  setAlertRulesOpen: (v: boolean) => void;
  searchInput: string;
  setSearchInput: (v: string) => void;
   
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  // ── Queries ─────────────────────────────────────────────────────────────────
  const combinedParams: LogListParams = { ...filters, ...timeRange };

  const {
    data: logsData,
    isLoading: logsLoading,
  } = useQuery({
    queryKey: ['logs', projectId, combinedParams],
    queryFn: () => logsApi.list(projectId, combinedParams),
    staleTime: 30_000,
    enabled: !!projectId && !isTailing,
  });

  const { data: statsData } = useQuery({
    queryKey: ['logs-stats', projectId, timeRange],
    queryFn: () => logsApi.getStats(projectId, timeRange.start, timeRange.end, '15m'),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const linkMutation = useMutation({
    mutationFn: ({ logId, issueId }: { logId: string; issueId: string }) =>
      logsApi.linkToIssue(projectId, logId, issueId),
    onSuccess: () => {
      toast.success('Log linked to issue');
      void queryClient.invalidateQueries({ queryKey: ['logs', projectId] });
    },
    onError: () => {
      toast.error('Failed to link log to issue');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (logId: string) => logsApi.unlinkFromIssue(projectId, logId),
    onSuccess: () => {
      toast.success('Log unlinked from issue');
      void queryClient.invalidateQueries({ queryKey: ['logs', projectId] });
    },
    onError: () => {
      toast.error('Failed to unlink log');
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleTimeRange = useCallback(
    (label: string, minutes: number) => {
      setSelectedTimeLabel(label);
      const end = new Date();
      const start = new Date(end.getTime() - minutes * 60 * 1000);
      setTimeRange({ start: start.toISOString(), end: end.toISOString() });
    },
    [setSelectedTimeLabel, setTimeRange]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFilters({ ...filters, search: searchInput || undefined, page: 1 });
    },
    [filters, searchInput, setFilters]
  );

  const handleLinkToIssue = useCallback(
    (logId: string) => {
      const issueId = prompt('Enter the Issue ID to link this log to:');
      if (issueId?.trim()) {
        linkMutation.mutate({ logId, issueId: issueId.trim() });
      }
    },
    [linkMutation]
  );

  const handleUnlinkFromIssue = useCallback(
    (logId: string) => {
      unlinkMutation.mutate(logId);
    },
    [unlinkMutation]
  );

  const handleFilterChange = useCallback(
    (newFilters: LogListParams) => {
      setFilters({ ...newFilters, page: 1 });
    },
    [setFilters]
  );

  const pagination = logsData?.pagination;
  const logs = logsData?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-heading-lg flex items-center gap-2">
            <ScrollText className="h-6 w-6" />
            Log Monitoring
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Search, filter, and tail your application logs in real-time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range selector */}
          <div className="flex bg-surface-3 rounded-lg border border-border-subtle p-0.5">
            {TIME_RANGE_OPTIONS.map(({ label, minutes }) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                className={`px-3 py-1.5 text-xs ${
                  selectedTimeLabel === label
                    ? 'bg-accent-2/12 text-accent-2'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => handleTimeRange(label, minutes)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Live tail toggle */}
          <Button
            variant={isTailing ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setIsTailing(!isTailing)}
          >
            <Radio className={`h-3.5 w-3.5 ${isTailing ? 'animate-pulse' : ''}`} />
            {isTailing ? 'Stop Tail' : 'Live Tail'}
          </Button>

          {/* Alert rules */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setAlertRulesOpen(true)}
          >
            <Bell className="h-3.5 w-3.5" />
            Alert Rules
          </Button>
        </div>
      </div>

      {/* Saved searches bar + filter bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SavedSearchBar
            projectId={projectId}
            currentFilters={{ ...filters, ...timeRange }}
            onLoadSearch={(savedFilters) => {
              const { start, end, ...rest } = savedFilters;
              if (start && end) setTimeRange({ start, end });
              setFilters({ ...rest, page: 1 });
            }}
          />
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search input */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 pr-3 text-xs w-56"
                placeholder="Search messages…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">
              Search
            </Button>
          </form>

          {/* Level filter */}
          <Select
            value={filters.level ?? 'all'}
            onValueChange={(v) =>
              setFilters({ ...filters, level: v === 'all' ? undefined : v, page: 1 })
            }
          >
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="trace">trace</SelectItem>
              <SelectItem value="debug">debug</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warn">warn</SelectItem>
              <SelectItem value="error">error</SelectItem>
              <SelectItem value="fatal">fatal</SelectItem>
            </SelectContent>
          </Select>

          {/* Service filter */}
          <Input
            className="h-8 text-xs w-36"
            placeholder="Service name…"
            value={filters.service_name ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, service_name: e.target.value || undefined, page: 1 })
            }
          />

          {/* Environment filter */}
          <Input
            className="h-8 text-xs w-32"
            placeholder="Environment…"
            value={filters.environment ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, environment: e.target.value || undefined, page: 1 })
            }
          />

          {/* Reset filters */}
          {(filters.level || filters.search || filters.service_name || filters.environment) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setFilters({ page: 1, per_page: 50 });
                setSearchInput('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Volume chart */}
      {statsData && (
        <Card className="border-border-subtle">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Log Volume ({statsData.total.toLocaleString()} total)
              </h3>
            </div>
            <LogVolumeChart stats={statsData} />
          </CardContent>
        </Card>
      )}

      {/* Main layout: facet sidebar + content */}
      <div className="flex gap-4 items-start">
        <LogFacetSidebar
          projectId={projectId}
          filters={filters}
          onFilterChange={handleFilterChange}
        />

        <div className="flex-1 min-w-0 space-y-3">
          {/* Live tail panel */}
          {isTailing && (
            <LogTailPanel
              projectId={projectId}
              isActive={isTailing}
              onToggle={() => setIsTailing(false)}
            />
          )}

          {/* Log table (shown when not tailing) */}
          {!isTailing && (
            <>
              {logsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full rounded" />
                  ))}
                </div>
              ) : (
                <LogTable
                  logs={logs}
                  onLinkToIssue={handleLinkToIssue}
                  onUnlinkFromIssue={handleUnlinkFromIssue}
                />
              )}

              {/* Pagination */}
              {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Page {pagination.page} of {pagination.total_pages} &middot;{' '}
                    {pagination.total.toLocaleString()} entries
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={pagination.page <= 1}
                      onClick={() =>
                        setFilters({ ...filters, page: (filters.page ?? 1) - 1 })
                      }
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={pagination.page >= pagination.total_pages}
                      onClick={() =>
                        setFilters({ ...filters, page: (filters.page ?? 1) + 1 })
                      }
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alert rules modal */}
      <AlertRulesModal
        projectId={projectId}
        isOpen={isAlertRulesOpen}
        onClose={() => setAlertRulesOpen(false)}
      />
    </div>
  );
}
