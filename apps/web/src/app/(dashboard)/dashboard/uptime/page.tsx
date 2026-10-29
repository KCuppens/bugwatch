"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Plus,
  Globe,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";
import {
  monitorsApi,
  type MonitorResponse,
  type MonitorDetailResponse,
  type MonitorCheck,
  type MonitorIncident,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

function formatCheckTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatIncidentDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Skeleton loading for the stats row + monitor cards
function LoadingSkeleton() {
  return (
    <>
      {/* Stat card skeletons */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="h-4 w-4 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Monitor card skeletons */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded" />
                    <Skeleton className="h-8 w-8 rounded" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

// Expanded detail panel for a single monitor
function MonitorDetail({ projectId, monitorId }: { projectId: string; monitorId: string }) {
  const [detail, setDetail] = useState<MonitorDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchDetail() {
      setIsLoading(true);
      try {
        const data = await monitorsApi.get(projectId, monitorId);
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) toast.error("Failed to load monitor details");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchDetail();
    return () => {
      cancelled = true;
    };
  }, [projectId, monitorId]);

  if (isLoading) {
    return (
      <div className="mt-4 border-t pt-4 space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!detail) {
    return <div className="mt-4 border-t pt-4 text-sm text-muted-foreground">Failed to load details.</div>;
  }

  const chartData = [...detail.recent_checks].reverse().map((check: MonitorCheck) => ({
    time: formatCheckTime(check.checked_at),
    response_time: check.response_time_ms ?? 0,
    status: check.status,
  }));

  const lastCheck = detail.recent_checks.length > 0 ? detail.recent_checks[0] : null;

  return (
    <div className="mt-4 border-t pt-4 space-y-6">
      {/* Response Time Chart */}
      {chartData.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Response Time</h4>
          <figure className="h-48 w-full">
            <figcaption className="sr-only">Response time chart for this monitor over recent checks</figcaption>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`gradient-${monitorId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickFormatter={(v: number) => `${v}ms`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [`${value}ms`, "Response Time"]}
                />
                <Area
                  type="monotone"
                  dataKey="response_time"
                  stroke="hsl(var(--primary))"
                  fill={`url(#gradient-${monitorId})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </figure>
        </div>
      )}

      {/* Last Check Info */}
      {lastCheck && (
        <div>
          <h4 className="text-sm font-medium mb-2">Last Check</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className={`font-medium ${lastCheck.status === "up" ? "text-green-500" : "text-red-500"}`}>
                {lastCheck.status.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Status Code</p>
              <p className="font-medium">{lastCheck.status_code ?? "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Response Time</p>
              <p className="font-medium">
                {lastCheck.response_time_ms !== null ? `${lastCheck.response_time_ms}ms` : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Checked At</p>
              <p className="font-medium">{formatIncidentDate(lastCheck.checked_at)}</p>
            </div>
            {lastCheck.error_message && (
              <div className="col-span-full">
                <p className="text-muted-foreground">Error</p>
                <p className="font-medium text-red-500">{lastCheck.error_message}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Incident Timeline */}
      <div>
        <h4 className="text-sm font-medium mb-2">Recent Incidents ({detail.recent_incidents.length})</h4>
        {detail.recent_incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent incidents. Looking good!</p>
        ) : (
          <div className="space-y-2">
            {detail.recent_incidents.map((incident: MonitorIncident) => (
              <div key={incident.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <div
                  className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${
                    incident.resolved_at ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{incident.resolved_at ? "Resolved" : "Ongoing"}</span>
                    <span className="text-muted-foreground">Started {formatIncidentDate(incident.started_at)}</span>
                    {incident.resolved_at && (
                      <span className="text-muted-foreground">
                        - Resolved {formatIncidentDate(incident.resolved_at)}
                      </span>
                    )}
                  </div>
                  {incident.cause && <p className="text-muted-foreground mt-1 truncate">{incident.cause}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UptimePage() {
  const { selectedProject } = useProject();

  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedMonitorId, setExpandedMonitorId] = useState<string | null>(null);
  const [selectedMonitors, setSelectedMonitors] = useState<Set<string>>(new Set());

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [monitorToDelete, setMonitorToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk delete confirmation state
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Form state
  const [newMonitor, setNewMonitor] = useState({
    name: "",
    url: "",
    method: "GET",
    interval_seconds: 60,
  });

  const fetchMonitors = useCallback(
    async (showLoading = false) => {
      if (!selectedProject) {
        setMonitors([]);
        setIsLoading(false);
        return;
      }

      if (showLoading) setIsLoading(true);
      try {
        const response = await monitorsApi.list(selectedProject.id);
        setMonitors(response.data);
      } catch {
        toast.error("Failed to fetch monitors");
        setMonitors([]);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedProject]
  );

  // Fetch monitors when selected project changes
  useEffect(() => {
    fetchMonitors(true);
  }, [fetchMonitors]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!selectedProject) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    function handleVisibility() {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } else {
        fetchMonitors(true);
        interval = setInterval(fetchMonitors, 30000);
      }
    }

    if (!document.hidden) {
      interval = setInterval(fetchMonitors, 30000);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [selectedProject, fetchMonitors]);

  async function handleCreateMonitor() {
    if (!selectedProject || !newMonitor.name || !newMonitor.url) return;

    setIsCreating(true);
    try {
      const response = await monitorsApi.create(selectedProject.id, {
        name: newMonitor.name,
        url: newMonitor.url,
        method: newMonitor.method,
        interval_seconds: newMonitor.interval_seconds,
      });
      setMonitors([response, ...monitors]);
      setShowCreateModal(false);
      setNewMonitor({ name: "", url: "", method: "GET", interval_seconds: 60 });
      toast.success("Monitor created successfully");
    } catch {
      toast.error("Failed to create monitor");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleMonitor(monitor: MonitorResponse) {
    if (!selectedProject) return;

    try {
      const response = await monitorsApi.update(selectedProject.id, monitor.id, {
        is_active: !monitor.is_active,
      });
      setMonitors(monitors.map((m) => (m.id === monitor.id ? response : m)));
      toast.success(response.is_active ? `Monitor "${monitor.name}" resumed` : `Monitor "${monitor.name}" paused`);
    } catch {
      toast.error("Failed to update monitor status");
    }
  }

  function handleDeleteClick(monitorId: string) {
    setMonitorToDelete(monitorId);
    setDeleteConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    if (!selectedProject || !monitorToDelete) return;

    setIsDeleting(true);
    try {
      await monitorsApi.delete(selectedProject.id, monitorToDelete);
      setMonitors(monitors.filter((m) => m.id !== monitorToDelete));
      if (expandedMonitorId === monitorToDelete) {
        setExpandedMonitorId(null);
      }
      toast.success("Monitor deleted");
      setDeleteConfirmOpen(false);
      setMonitorToDelete(null);
    } catch {
      toast.error("Failed to delete monitor");
    } finally {
      setIsDeleting(false);
    }
  }

  const toggleMonitorSelection = (id: string) => {
    const newSelected = new Set(selectedMonitors);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedMonitors(newSelected);
  };

  async function handleBulkPause() {
    if (!selectedProject) return;
    const ids = Array.from(selectedMonitors).filter((id) => monitors.find((m) => m.id === id)?.is_active);
    const results = await Promise.allSettled(
      ids.map((id) => monitorsApi.update(selectedProject.id, id, { is_active: false }))
    );
    const updated = results.flatMap((r, i) => (r.status === "fulfilled" ? [{ id: ids[i], data: r.value }] : []));
    setMonitors((prev) => prev.map((m) => updated.find((u) => u.id === m.id)?.data ?? m));
    setSelectedMonitors(new Set());
    const succeeded = updated.length;
    if (succeeded < ids.length) {
      toast.warning(`${succeeded} of ${ids.length} monitors paused`);
    } else {
      toast.success(`${succeeded} monitor${succeeded !== 1 ? "s" : ""} paused`);
    }
  }

  async function handleBulkResume() {
    if (!selectedProject) return;
    const ids = Array.from(selectedMonitors).filter((id) => !monitors.find((m) => m.id === id)?.is_active);
    const results = await Promise.allSettled(
      ids.map((id) => monitorsApi.update(selectedProject.id, id, { is_active: true }))
    );
    const updated = results.flatMap((r, i) => (r.status === "fulfilled" ? [{ id: ids[i], data: r.value }] : []));
    setMonitors((prev) => prev.map((m) => updated.find((u) => u.id === m.id)?.data ?? m));
    setSelectedMonitors(new Set());
    const succeeded = updated.length;
    if (succeeded < ids.length) {
      toast.warning(`${succeeded} of ${ids.length} monitors resumed`);
    } else {
      toast.success(`${succeeded} monitor${succeeded !== 1 ? "s" : ""} resumed`);
    }
  }

  async function handleBulkDelete() {
    if (!selectedProject) return;
    setBulkDeleteConfirmOpen(true);
  }

  async function handleConfirmBulkDelete() {
    if (!selectedProject) return;
    const ids = Array.from(selectedMonitors);
    const results = await Promise.allSettled(ids.map((id) => monitorsApi.delete(selectedProject.id, id)));
    const deletedIds = new Set(ids.filter((_, i) => results[i]?.status === "fulfilled"));
    setMonitors((prev) => prev.filter((m) => !deletedIds.has(m.id)));
    setSelectedMonitors(new Set());
    setBulkDeleteConfirmOpen(false);
    const succeeded = deletedIds.size;
    if (succeeded < ids.length) {
      toast.warning(`${succeeded} of ${ids.length} monitors deleted`);
    } else {
      toast.success(`${succeeded} monitor${succeeded !== 1 ? "s" : ""} deleted`);
    }
  }

  // Calculate stats — memoized so re-renders from selectedMonitors/modal state don't recompute
  const { activeMonitors, upMonitors, avgUptime, avgResponse } = useMemo(() => {
    const active = monitors.filter((m) => m.is_active).length;
    const up = monitors.filter((m) => m.current_status === "up").length;
    const withUptime = monitors.filter((m) => m.uptime_24h != null);
    const uptime =
      withUptime.length > 0 ? withUptime.reduce((sum, m) => sum + m.uptime_24h!, 0) / withUptime.length : null;
    const withResponse = monitors.filter((m) => m.avg_response_24h != null);
    const response =
      withResponse.length > 0
        ? withResponse.reduce((sum, m) => sum + m.avg_response_24h!, 0) / withResponse.length
        : null;
    return { activeMonitors: active, upMonitors: up, avgUptime: uptime, avgResponse: response };
  }, [monitors]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-heading-lg">Uptime Monitoring</h1>
          <p className="text-body-sm text-muted-foreground mt-1">
            Monitor your endpoints and get alerted when they go down
          </p>
        </div>
        <Button variant="success" onClick={() => setShowCreateModal(true)} disabled={!selectedProject}>
          <Plus className="mr-2 h-4 w-4" />
          Add Monitor
        </Button>
      </div>

      {/* Loading skeleton replaces the Loader2 spinner */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-display text-2xl font-semibold tabular-nums">{activeMonitors}</p>
                  <p className="text-caption uppercase tracking-wide text-muted-foreground">Active Monitors</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle className="h-4 w-4 text-bug" />
                <div>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {avgUptime !== null ? `${avgUptime.toFixed(1)}%` : "-"}
                  </p>
                  <p className="text-caption uppercase tracking-wide text-muted-foreground">Overall Uptime (24h)</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {avgResponse !== null ? `${Math.round(avgResponse)}ms` : "-"}
                  </p>
                  <p className="text-caption uppercase tracking-wide text-muted-foreground">Avg Response (24h)</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {upMonitors}/{monitors.length}
                  </p>
                  <p className="text-caption uppercase tracking-wide text-muted-foreground">Currently Up</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bulk Actions Bar */}
          {selectedMonitors.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-accent-2/5 border border-accent-2/20">
              <span className="text-sm font-medium">{selectedMonitors.size} selected</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkPause}>
                  <Pause className="h-3 w-3 mr-1" />
                  Pause
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkResume}>
                  <Play className="h-3 w-3 mr-1" />
                  Resume
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={handleBulkDelete}>
                  <Trash2 className="h-3 w-3 mr-1" />
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setSelectedMonitors(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* Monitor List */}
          {monitors.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={<Activity />}
                  title="No monitors yet"
                  description={
                    selectedProject
                      ? "Add your first uptime monitor to start tracking the availability of your websites and APIs."
                      : "Select a project from the sidebar to view and create monitors."
                  }
                  action={
                    selectedProject ? (
                      <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Your First Monitor
                      </Button>
                    ) : undefined
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {monitors.map((monitor) => {
                const isExpanded = expandedMonitorId === monitor.id;
                return (
                  <Card key={monitor.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-4">
                          <button
                            role="checkbox"
                            aria-checked={selectedMonitors.has(monitor.id)}
                            aria-label={`Select ${monitor.name}`}
                            onClick={() => toggleMonitorSelection(monitor.id)}
                            onKeyDown={(e) => {
                              if (e.key === " ") {
                                e.preventDefault();
                                toggleMonitorSelection(monitor.id);
                              }
                            }}
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                              selectedMonitors.has(monitor.id)
                                ? "bg-accent-2 border-accent-2"
                                : "border-muted-foreground/30 hover:border-accent-2/50"
                            }`}
                          >
                            {selectedMonitors.has(monitor.id) && <Check className="h-3 w-3 text-accent-2-foreground" />}
                          </button>
                          <div
                            className={`rounded-full p-2 ${
                              monitor.current_status === "up"
                                ? "bg-bug/10"
                                : monitor.current_status === "down"
                                  ? "bg-red-100 dark:bg-red-950"
                                  : "bg-gray-100 dark:bg-gray-800"
                            }`}
                          >
                            {monitor.current_status === "up" ? (
                              <CheckCircle className="h-5 w-5 text-bug" />
                            ) : monitor.current_status === "down" ? (
                              <XCircle className="h-5 w-5 text-red-500" />
                            ) : (
                              <AlertCircle className="h-5 w-5 text-gray-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{monitor.name}</h3>
                              {!monitor.is_active && (
                                <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 px-2 py-0.5 rounded">
                                  Paused
                                </span>
                              )}
                              {monitor.current_status === "down" && (
                                <span className="text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-2 py-0.5 rounded font-medium">
                                  DOWN
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {monitor.method} {monitor.url}
                            </p>
                            {monitor.current_status === "down" && monitor.last_error && (
                              <p className="text-sm text-red-600 dark:text-red-400 mt-1 truncate">
                                Error: {monitor.last_error}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {monitor.uptime_24h !== null ? `${monitor.uptime_24h.toFixed(1)}%` : "-"}
                            </p>
                            <p className="text-xs text-muted-foreground">Uptime</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {monitor.avg_response_24h !== null ? `${Math.round(monitor.avg_response_24h)}ms` : "-"}
                            </p>
                            <p className="text-xs text-muted-foreground">Response</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">{formatRelativeTime(monitor.last_checked_at)}</p>
                            <p className="text-xs text-muted-foreground">Last Check</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleMonitor(monitor)}
                              aria-label={monitor.is_active ? `Pause ${monitor.name}` : `Resume ${monitor.name}`}
                            >
                              {monitor.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteClick(monitor.id)}
                              aria-label={`Delete ${monitor.name}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                            <button
                              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${monitor.name} details`}
                              aria-expanded={isExpanded}
                              aria-controls={`monitor-detail-${monitor.id}`}
                              onClick={() => setExpandedMonitorId(isExpanded ? null : monitor.id)}
                              className="p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded inline detail */}
                      <div id={`monitor-detail-${monitor.id}`}>
                        {isExpanded && selectedProject && (
                          <MonitorDetail projectId={selectedProject.id} monitorId={monitor.id} />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create Monitor Dialog */}
      <Dialog
        open={showCreateModal}
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setNewMonitor({ name: "", url: "", method: "GET", interval_seconds: 60 });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Monitor</DialogTitle>
            <DialogDescription>Add a new uptime monitor to track endpoint availability.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My API"
                value={newMonitor.name}
                onChange={(e) => setNewMonitor({ ...newMonitor, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://api.example.com/health"
                value={newMonitor.url}
                onChange={(e) => setNewMonitor({ ...newMonitor, url: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <Select value={newMonitor.method} onValueChange={(v) => setNewMonitor({ ...newMonitor, method: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="HEAD">HEAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="interval">Check Interval</Label>
                <Select
                  value={String(newMonitor.interval_seconds)}
                  onValueChange={(v) => setNewMonitor({ ...newMonitor, interval_seconds: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                    <SelectItem value="300">5 minutes</SelectItem>
                    <SelectItem value="600">10 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateMonitor} disabled={isCreating || !newMonitor.name || !newMonitor.url}>
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Monitor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setMonitorToDelete(null);
        }}
        title="Delete Monitor"
        description="Are you sure you want to delete this monitor? This action cannot be undone and all associated check history will be lost."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleConfirmDelete}
        loading={isDeleting}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
        title={`Delete ${selectedMonitors.size} Monitors`}
        description={`Are you sure you want to delete ${selectedMonitors.size} monitors? This action cannot be undone and all associated check history will be lost.`}
        confirmLabel="Delete All"
        variant="destructive"
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  );
}
