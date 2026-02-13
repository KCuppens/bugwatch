"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Server,
  Terminal,
  Clock,
  Container,
  Copy,
  Check,
  Search,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  serversApi,
  type ServerInfo,
  type ServerMetricData,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "N/A";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "N/A";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getStatusColor(value: number | null, warn: number = 70, crit: number = 90): string {
  if (value === null) return "text-muted-foreground";
  if (value >= crit) return "text-red-400";
  if (value >= warn) return "text-yellow-400";
  return "text-green-400";
}

function getStatusBg(value: number | null, warn: number = 70, crit: number = 90): string {
  if (value === null) return "bg-white/5";
  if (value >= crit) return "bg-red-500/10 border-red-500/20";
  if (value >= warn) return "bg-yellow-500/10 border-yellow-500/20";
  return "bg-green-500/10 border-green-500/20";
}

export default function ServerPage() {
  const { selectedProject } = useProject();

  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("1h");
  const [metrics, setMetrics] = useState<ServerMetricData[]>([]);
  const [latest, setLatest] = useState<ServerMetricData | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasAgent, setHasAgent] = useState<boolean | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [processSort, setProcessSort] = useState<{ field: "cpu" | "mem" | "name"; dir: "asc" | "desc" }>({ field: "cpu", dir: "desc" });
  const [processFilter, setProcessFilter] = useState("");
  const [showAllProcesses, setShowAllProcesses] = useState(false);

  // Fetch servers when project changes
  useEffect(() => {
    if (!selectedProject) {
      setIsLoading(false);
      setHasAgent(null);
      setServers([]);
      setSelectedServer(null);
      setMetrics([]);
      setLatest(null);
      setServerInfo(null);
      return;
    }
    let cancelled = false;
    async function fetchServers() {
      setIsLoading(true);
      setHasAgent(null);
      setServers([]);
      setSelectedServer(null);
      setMetrics([]);
      setLatest(null);
      setServerInfo(null);
      try {
        const status = await serversApi.hasAgent(selectedProject!.id);
        if (cancelled) return;
        setHasAgent(status.has_agent);

        if (status.has_agent) {
          const response = await serversApi.listServers(selectedProject!.id);
          if (cancelled) return;
          setServers(response.data);
          const firstServer = response.data[0];
          setSelectedServer(firstServer ? firstServer.id : null);
        } else {
          setServers([]);
          setSelectedServer(null);
        }
      } catch (err) {
        if (cancelled) return;
        toast.error("Failed to load servers");
        setHasAgent(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchServers();
    return () => { cancelled = true; };
  }, [selectedProject]);

  // Fetch metrics when server/period changes
  const fetchMetrics = useCallback(async () => {
    if (!selectedProject || !selectedServer) return;
    try {
      const [metricsRes, latestRes] = await Promise.all([
        serversApi.getMetrics(selectedProject.id, selectedServer, period),
        serversApi.getLatest(selectedProject.id, selectedServer),
      ]);
      setMetrics(metricsRes.data);
      setLatest(latestRes.data);
      setServerInfo(latestRes.server);
    } catch (err) {
      toast.error("Failed to load metrics");
    }
  }, [selectedProject, selectedServer, period]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Poll every 30 seconds
  useEffect(() => {
    if (!selectedProject || !selectedServer) return;
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics, selectedProject, selectedServer]);

  // Get API key for install command
  const apiKey = selectedProject?.api_key || "<your_api_key>";

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-48 w-full rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // No project selected
  if (!selectedProject) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Server Monitoring</h1>
          <p className="text-muted-foreground mt-1">
            Select a project from the sidebar to view server metrics.
          </p>
        </div>
      </div>
    );
  }

  // Empty state — no agent installed
  if (hasAgent === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Server Monitoring</h1>
          <p className="text-muted-foreground mt-1">
            Monitor your server health alongside error tracking
          </p>
        </div>

        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Server className="h-8 w-8 text-accent" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Install the BugWatch Agent</h2>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                Run this one-liner on your server to start monitoring CPU, memory, disk, and network metrics.
              </p>
            </div>
            <div className="bg-black/40 rounded-lg p-4 max-w-2xl mx-auto text-left relative group">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Install command</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    try {
                      navigator.clipboard.writeText(`curl -sSL https://install.bugwatch.dev | bash -s -- --api-key ${apiKey}`);
                      setCopiedInstall(true);
                      toast.success("Install command copied");
                      setTimeout(() => setCopiedInstall(false), 2000);
                    } catch {
                      toast.error("Failed to copy — clipboard not available");
                    }
                  }}
                >
                  {copiedInstall ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copiedInstall ? "Copied" : "Copy"}
                </Button>
              </div>
              <code className="text-sm text-green-400 break-all">
                curl -sSL https://install.bugwatch.dev | bash -s -- --api-key {apiKey}
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              The agent collects metrics every 60 seconds and sends them securely to BugWatch.
              No root access required.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Chart data — transform metrics for recharts
  const chartData = metrics.map((m) => ({
    time: formatTime(m.recorded_at),
    timestamp: m.recorded_at,
    cpu: m.cpu_usage_percent ?? 0,
    memory: m.mem_usage_percent ?? 0,
    netRx: m.net_rx_bytes_per_sec ?? 0,
    netTx: m.net_tx_bytes_per_sec ?? 0,
    load1: m.load_avg_1 ?? 0,
    load5: m.load_avg_5 ?? 0,
    load15: m.load_avg_15 ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Server Monitoring</h1>
          <p className="text-muted-foreground mt-1">
            {serverInfo ? `${serverInfo.hostname}` : "Server health metrics"}
            {serverInfo?.os && ` — ${serverInfo.os}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {servers.length > 1 && (
            <Select value={selectedServer || ""} onValueChange={setSelectedServer}>
              <SelectTrigger className="w-[200px] bg-white/5 border-white/10">
                <SelectValue placeholder="Select server" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.hostname}
                    {!s.is_active && " (offline)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex bg-white/5 rounded-lg border border-white/10 p-0.5">
            {["1h", "6h", "24h", "7d"].map((p) => (
              <Button
                key={p}
                variant="ghost"
                size="sm"
                className={`px-3 py-1.5 text-xs ${
                  period === p
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={`border ${getStatusBg(latest?.cpu_usage_percent ?? null)}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">CPU</span>
            </div>
            <p className={`text-2xl font-bold ${getStatusColor(latest?.cpu_usage_percent ?? null)}`}>
              {latest?.cpu_usage_percent !== null && latest?.cpu_usage_percent !== undefined
                ? `${latest.cpu_usage_percent.toFixed(1)}%`
                : "N/A"}
            </p>
            {/* Threshold legend */}
            <div className="mt-2 flex items-center gap-0.5 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div className="h-full bg-green-500/60" style={{ width: "70%" }} />
              <div className="h-full bg-yellow-500/60" style={{ width: "20%" }} />
              <div className="h-full bg-red-500/60" style={{ width: "10%" }} />
            </div>
          </CardContent>
        </Card>

        <Card className={`border ${getStatusBg(latest?.mem_usage_percent ?? null)}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MemoryStick className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Memory</span>
            </div>
            <p className={`text-2xl font-bold ${getStatusColor(latest?.mem_usage_percent ?? null)}`}>
              {latest?.mem_usage_percent !== null && latest?.mem_usage_percent !== undefined
                ? `${latest.mem_usage_percent.toFixed(1)}%`
                : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatBytes(latest?.mem_used_bytes ?? null)} / {formatBytes(latest?.mem_total_bytes ?? null)}
            </p>
            <div className="mt-2 flex items-center gap-0.5 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div className="h-full bg-green-500/60" style={{ width: "70%" }} />
              <div className="h-full bg-yellow-500/60" style={{ width: "20%" }} />
              <div className="h-full bg-red-500/60" style={{ width: "10%" }} />
            </div>
          </CardContent>
        </Card>

        <Card className={`border ${getStatusBg(
          latest?.disks?.[0]?.usage_percent ?? null
        )}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Disk</span>
            </div>
            <p className={`text-2xl font-bold ${getStatusColor(
              latest?.disks?.[0]?.usage_percent ?? null
            )}`}>
              {latest?.disks?.[0]?.usage_percent !== undefined
                ? `${latest.disks[0].usage_percent.toFixed(1)}%`
                : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {latest?.disks?.[0] && `${formatBytes(latest.disks[0].used_bytes)} / ${formatBytes(latest.disks[0].total_bytes)}`}
            </p>
            <div className="mt-2 flex items-center gap-0.5 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div className="h-full bg-green-500/60" style={{ width: "70%" }} />
              <div className="h-full bg-yellow-500/60" style={{ width: "20%" }} />
              <div className="h-full bg-red-500/60" style={{ width: "10%" }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-white/[0.02] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Load Average</span>
            </div>
            <p className="text-2xl font-bold">
              {latest?.load_avg_1 !== null && latest?.load_avg_1 !== undefined
                ? latest.load_avg_1.toFixed(2)
                : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {latest?.load_avg_5 != null && `5m: ${latest?.load_avg_5?.toFixed(2)}`}
              {latest?.load_avg_15 != null && ` · 15m: ${latest?.load_avg_15?.toFixed(2)}`}
            </p>
            <div className="mt-2 flex items-center gap-0.5 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div className="h-full bg-green-500/60" style={{ width: "50%" }} />
              <div className="h-full bg-yellow-500/60" style={{ width: "30%" }} />
              <div className="h-full bg-red-500/60" style={{ width: "20%" }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU Chart */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-4">CPU Usage</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#888" }} unit="%" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                    labelStyle={{ color: "#888" }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="CPU %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Memory Chart */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-4">Memory Usage</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#888" }} unit="%" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                    labelStyle={{ color: "#888" }}
                  />
                  <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} name="Memory %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Network I/O Chart */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-4">Network I/O</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#888" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                    labelStyle={{ color: "#888" }}
                    formatter={(value: number) => formatBytes(value) + "/s"}
                  />
                  <Area type="monotone" dataKey="netRx" stroke="#10b981" fill="#10b981" fillOpacity={0.1} name="RX" />
                  <Area type="monotone" dataKey="netTx" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name="TX" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Load Average Chart */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-4">Load Average</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#888" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                    labelStyle={{ color: "#888" }}
                  />
                  <Area type="monotone" dataKey="load1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.05} name="1m" />
                  <Area type="monotone" dataKey="load5" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.05} name="5m" />
                  <Area type="monotone" dataKey="load15" stroke="#ec4899" fill="#ec4899" fillOpacity={0.05} name="15m" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Server Info + Uptime */}
      {serverInfo && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Server Information</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Hostname</span>
                <p className="font-medium">{serverInfo.hostname}</p>
              </div>
              <div>
                <span className="text-muted-foreground">OS</span>
                <p className="font-medium">{serverInfo.os || "N/A"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Kernel</span>
                <p className="font-medium">{serverInfo.kernel || "N/A"}</p>
              </div>
              <div className="flex items-start gap-2">
                <div>
                  <span className="text-muted-foreground">Uptime</span>
                  <p className="font-medium flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatUptime(latest?.uptime_seconds ?? null)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disk Table */}
      {latest?.disks && latest.disks.length > 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Disk Usage</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left border-b border-white/10">
                    <th className="pb-2 font-medium">Mount</th>
                    <th className="pb-2 font-medium">Filesystem</th>
                    <th className="pb-2 font-medium">Used</th>
                    <th className="pb-2 font-medium">Available</th>
                    <th className="pb-2 font-medium">Total</th>
                    <th className="pb-2 font-medium w-48">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.disks.map((disk, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2 font-mono text-xs">{disk.mount}</td>
                      <td className="py-2 text-muted-foreground">{disk.filesystem || "—"}</td>
                      <td className="py-2">{formatBytes(disk.used_bytes)}</td>
                      <td className="py-2">{formatBytes(disk.available_bytes)}</td>
                      <td className="py-2">{formatBytes(disk.total_bytes)}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                disk.usage_percent >= 90
                                  ? "bg-red-500"
                                  : disk.usage_percent >= 70
                                  ? "bg-yellow-500"
                                  : "bg-green-500"
                              }`}
                              style={{ width: `${Math.min(disk.usage_percent, 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-medium ${getStatusColor(disk.usage_percent)}`}>
                            {disk.usage_percent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Process Table - Sortable & Filterable */}
      {latest?.processes && latest.processes.length > 0 && (() => {
        const filtered = latest.processes.filter(p =>
          !processFilter || p.name.toLowerCase().includes(processFilter.toLowerCase())
        );
        const sorted = [...filtered].sort((a, b) => {
          const dir = processSort.dir === "asc" ? 1 : -1;
          if (processSort.field === "cpu") return (a.cpu_percent - b.cpu_percent) * dir;
          if (processSort.field === "mem") return (a.mem_percent - b.mem_percent) * dir;
          return a.name.localeCompare(b.name) * dir;
        });
        const displayed = showAllProcesses ? sorted : sorted.slice(0, 10);

        const SortIcon = ({ field }: { field: typeof processSort.field }) => {
          if (processSort.field !== field) return null;
          return processSort.dir === "desc" ? <ChevronDown className="h-3 w-3 inline ml-0.5" /> : <ChevronUp className="h-3 w-3 inline ml-0.5" />;
        };

        const toggleSort = (field: typeof processSort.field) => {
          setProcessSort(prev => ({
            field,
            dir: prev.field === field && prev.dir === "desc" ? "asc" : "desc",
          }));
        };

        return (
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Processes ({filtered.length})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={processFilter}
                      onChange={(e) => setProcessFilter(e.target.value)}
                      className="h-7 pl-7 pr-2 text-xs rounded-md border bg-background w-36"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowAllProcesses(!showAllProcesses)}
                  >
                    {showAllProcesses ? "Show top 10" : `Show all ${filtered.length}`}
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-left border-b border-white/10">
                      <th className="pb-2 font-medium">PID</th>
                      <th className="pb-2 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>
                        Name <SortIcon field="name" />
                      </th>
                      <th className="pb-2 font-medium">User</th>
                      <th className="pb-2 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("cpu")}>
                        CPU % <SortIcon field="cpu" />
                      </th>
                      <th className="pb-2 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("mem")}>
                        MEM % <SortIcon field="mem" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((proc, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2 font-mono text-xs">{proc.pid}</td>
                        <td className="py-2">{proc.name}</td>
                        <td className="py-2 text-muted-foreground">{proc.user || "—"}</td>
                        <td className="py-2">
                          <span className={getStatusColor(proc.cpu_percent)}>{proc.cpu_percent.toFixed(1)}%</span>
                        </td>
                        <td className="py-2">
                          <span className={getStatusColor(proc.mem_percent)}>{proc.mem_percent.toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Docker Table */}
      {latest?.docker && latest.docker.length > 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Container className="h-4 w-4" />
              Docker Containers
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left border-b border-white/10">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">CPU %</th>
                    <th className="pb-2 font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.docker.map((container, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2 font-mono text-xs">{container.name}</td>
                      <td className="py-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                          container.status.toLowerCase().includes("up")
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}>
                          {container.status}
                        </span>
                      </td>
                      <td className="py-2">{container.cpu_percent?.toFixed(1) ?? "N/A"}%</td>
                      <td className="py-2">{container.mem_usage || "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
