"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "lucide-react";
import {
  monitorsApi,
  projectsApi,
  type MonitorResponse,
  type Project,
} from "@/lib/api";

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export default function UptimePage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [newMonitor, setNewMonitor] = useState({
    name: "",
    url: "",
    method: "GET",
    interval_seconds: 60,
  });

  // Fetch projects on mount
  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await projectsApi.list();
        setProjects(response.data);
        const firstProject = response.data[0];
        if (!selectedProject && firstProject) {
          setSelectedProject(firstProject.id);
        }
      } catch (err) {
        console.error("Failed to fetch projects:", err);
      }
    }
    fetchProjects();
  }, [selectedProject]);

  // Fetch monitors when project changes
  useEffect(() => {
    async function fetchMonitors() {
      if (!selectedProject) {
        setMonitors([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await monitorsApi.list(selectedProject);
        setMonitors(response.data);
      } catch (err) {
        console.error("Failed to fetch monitors:", err);
        setMonitors([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchMonitors();
  }, [selectedProject]);

  async function handleCreateMonitor() {
    if (!selectedProject || !newMonitor.name || !newMonitor.url) return;

    setIsCreating(true);
    try {
      const response = await monitorsApi.create(selectedProject, {
        name: newMonitor.name,
        url: newMonitor.url,
        method: newMonitor.method,
        interval_seconds: newMonitor.interval_seconds,
      });
      setMonitors([response, ...monitors]);
      setShowCreateModal(false);
      setNewMonitor({ name: "", url: "", method: "GET", interval_seconds: 60 });
    } catch (err) {
      console.error("Failed to create monitor:", err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleMonitor(monitor: MonitorResponse) {
    if (!selectedProject) return;

    try {
      const response = await monitorsApi.update(selectedProject, monitor.id, {
        is_active: !monitor.is_active,
      });
      setMonitors(monitors.map((m) => (m.id === monitor.id ? response : m)));
    } catch (err) {
      console.error("Failed to toggle monitor:", err);
    }
  }

  async function handleDeleteMonitor(monitorId: string) {
    if (!selectedProject) return;

    try {
      await monitorsApi.delete(selectedProject, monitorId);
      setMonitors(monitors.filter((m) => m.id !== monitorId));
    } catch (err) {
      console.error("Failed to delete monitor:", err);
    }
  }

  // Calculate stats
  const activeMonitors = monitors.filter((m) => m.is_active).length;
  const upMonitors = monitors.filter((m) => m.current_status === "up").length;
  const avgUptime = monitors.length > 0
    ? monitors.reduce((sum, m) => sum + (m.uptime_24h || 0), 0) / monitors.length
    : null;
  const avgResponse = monitors.length > 0
    ? monitors.reduce((sum, m) => sum + (m.avg_response_24h || 0), 0) / monitors.length
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Uptime Monitoring</h1>
          <p className="text-muted-foreground">
            Monitor your endpoints and get alerted when they go down
          </p>
        </div>
        <div className="flex items-center gap-4">
          {projects.length > 0 && (
            <Select
              value={selectedProject || undefined}
              onValueChange={setSelectedProject}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="success" onClick={() => setShowCreateModal(true)} disabled={!selectedProject}>
            <Plus className="mr-2 h-4 w-4" />
            Add Monitor
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{activeMonitors}</p>
              <p className="text-xs text-muted-foreground">Active Monitors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle className="h-4 w-4 text-bug" />
            <div>
              <p className="text-2xl font-bold">
                {avgUptime !== null ? `${avgUptime.toFixed(1)}%` : "-"}
              </p>
              <p className="text-xs text-muted-foreground">Overall Uptime (24h)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">
                {avgResponse !== null ? `${Math.round(avgResponse)}ms` : "-"}
              </p>
              <p className="text-xs text-muted-foreground">Avg Response (24h)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{upMonitors}/{monitors.length}</p>
              <p className="text-xs text-muted-foreground">Currently Up</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monitor List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : monitors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-muted p-4">
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-medium">No monitors yet</h3>
            <p className="mt-2 max-w-md text-center text-muted-foreground">
              {selectedProject
                ? "Add your first uptime monitor to start tracking the availability of your websites and APIs."
                : "Select a project to view and create monitors."}
            </p>
            {selectedProject && (
              <Button className="mt-6" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Monitor
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {monitors.map((monitor) => (
            <Card key={monitor.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
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
                        {monitor.uptime_24h !== null
                          ? `${monitor.uptime_24h.toFixed(1)}%`
                          : "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">Uptime</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {monitor.avg_response_24h !== null
                          ? `${Math.round(monitor.avg_response_24h)}ms`
                          : "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">Response</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatRelativeTime(monitor.last_checked_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">Last Check</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleMonitor(monitor)}
                        title={monitor.is_active ? "Pause monitor" : "Resume monitor"}
                      >
                        {monitor.is_active ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteMonitor(monitor.id)}
                        title="Delete monitor"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Monitor Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg sm:rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Create Monitor</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="My API"
                  value={newMonitor.name}
                  onChange={(e) =>
                    setNewMonitor({ ...newMonitor, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  placeholder="https://api.example.com/health"
                  value={newMonitor.url}
                  onChange={(e) =>
                    setNewMonitor({ ...newMonitor, url: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="method">Method</Label>
                  <Select
                    value={newMonitor.method}
                    onValueChange={(v) =>
                      setNewMonitor({ ...newMonitor, method: v })
                    }
                  >
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
                    onValueChange={(v) =>
                      setNewMonitor({ ...newMonitor, interval_seconds: Number(v) })
                    }
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
            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateMonitor}
                disabled={isCreating || !newMonitor.name || !newMonitor.url}
              >
                {isCreating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create Monitor
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
