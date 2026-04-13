"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Gauge,
  Clock,
  AlertTriangle,
  Zap,
  TrendingUp,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import {
  performanceApi,
  type PerformanceSummary,
  type TransactionAggregate,
  type TimeSeriesPoint,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { useFeature } from "@/hooks/use-feature";
import { LatencyChart } from "@/components/performance/LatencyChart";
import { ThroughputChart } from "@/components/performance/ThroughputChart";
import { TransactionTable } from "@/components/performance/TransactionTable";
import { cn } from "@/lib/utils";

type Period = "1h" | "6h" | "24h" | "7d";

const PERIODS: { label: string; value: Period; hours: number; interval: string }[] = [
  { label: "1h", value: "1h", hours: 1, interval: "5m" },
  { label: "6h", value: "6h", hours: 6, interval: "15m" },
  { label: "24h", value: "24h", hours: 24, interval: "1h" },
  { label: "7d", value: "7d", hours: 168, interval: "6h" },
];

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export default function PerformancePage() {
  const { selectedProject } = useProject();
  const hasPerformance = useFeature("performance_monitoring");
  const [period, setPeriod] = useState<Period>("24h");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [transactions, setTransactions] = useState<TransactionAggregate[]>([]);
  const [chartData, setChartData] = useState<TimeSeriesPoint[]>([]);

  const fetchData = useCallback(async () => {
    if (!selectedProject || !hasPerformance) return;

    setLoading(true);
    try {
      const periodConfig = PERIODS.find((p) => p.value === period)!;
      const end = new Date().toISOString();
      const start = new Date(
        Date.now() - periodConfig.hours * 60 * 60 * 1000
      ).toISOString();

      const [summaryRes, txnRes, chartRes] = await Promise.all([
        performanceApi.getSummary(selectedProject.id, start, end),
        performanceApi.listTransactions(selectedProject.id, start, end, 20),
        performanceApi.getCharts(
          selectedProject.id,
          start,
          end,
          periodConfig.interval
        ),
      ]);

      setSummary(summaryRes.data);
      setTransactions(txnRes.data);
      setChartData(chartRes.data);
    } catch (err) {
      toast.error("Failed to load performance data");
    } finally {
      setLoading(false);
    }
  }, [selectedProject, period, hasPerformance]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!hasPerformance) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="rounded-full bg-surface-3 p-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="font-display text-heading-md">Performance Monitoring</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Track transaction latency, throughput, and errors across your
          application. Upgrade to Pro to unlock performance monitoring.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-heading-lg flex items-center gap-2">
            <Gauge className="h-6 w-6 text-accent-2" />
            Performance
          </h1>
          <p className="text-body-sm text-muted-foreground mt-1">
            Transaction latency, throughput, and error rates
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 border border-border-subtle rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                period === p.value
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard
          label="P50"
          value={summary ? formatMs(summary.p50) : "--"}
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
        />
        <SummaryCard
          label="P75"
          value={summary ? formatMs(summary.p75) : "--"}
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
        />
        <SummaryCard
          label="P95"
          value={summary ? formatMs(summary.p95) : "--"}
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
          highlight={summary && summary.p95 > 1000}
        />
        <SummaryCard
          label="P99"
          value={summary ? formatMs(summary.p99) : "--"}
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={loading}
          highlight={summary && summary.p99 > 3000}
        />
        <SummaryCard
          label="Throughput"
          value={summary ? `${summary.throughput.toFixed(1)}/min` : "--"}
          icon={<Zap className="h-4 w-4" />}
          loading={loading}
        />
        <SummaryCard
          label="Error Rate"
          value={summary ? `${summary.error_rate.toFixed(1)}%` : "--"}
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={loading}
          highlight={summary && summary.error_rate > 5}
        />
        <SummaryCard
          label="Total"
          value={
            summary ? summary.total_transactions.toLocaleString() : "--"
          }
          icon={<TrendingUp className="h-4 w-4" />}
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-surface-2 border border-border-subtle">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Latency Percentiles</h3>
            <LatencyChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="bg-surface-2 border border-border-subtle">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Throughput & Errors</h3>
            <ThroughputChart data={chartData} />
          </CardContent>
        </Card>
      </div>

      {/* Transaction Table */}
      <Card className="bg-surface-2 border border-border-subtle">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Slowest Transactions</h3>
          <TransactionTable data={transactions} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  loading,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
  highlight?: boolean | null;
}) {
  return (
    <Card className="bg-surface-2 border border-border-subtle">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
          {icon}
          <span className="text-[11px] font-medium uppercase tracking-wide">
            {label}
          </span>
        </div>
        {loading ? (
          <div className="h-6 w-16 bg-surface-3 rounded animate-pulse" />
        ) : (
          <p
            className={cn(
              "text-lg font-semibold tabular-nums",
              highlight && "text-red-400"
            )}
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
