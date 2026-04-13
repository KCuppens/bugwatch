"use client";

import { memo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TimeSeriesPoint } from "@/lib/api";

interface LatencyChartProps {
  data: TimeSeriesPoint[];
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function LatencyChartImpl({ data }: LatencyChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        No data available for this time range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="colorP50" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorP75" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorP95" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorP99" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border-subtle))" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
        />
        <YAxis
          tickFormatter={formatMs}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--surface-2))",
            border: "1px solid hsl(var(--border-subtle))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelFormatter={formatTime}
          formatter={(value: number, name: string) => [formatMs(value), name]}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="p50"
          name="P50"
          stroke="hsl(var(--accent))"
          fill="url(#colorP50)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="p75"
          name="P75"
          stroke="#3b82f6"
          fill="url(#colorP75)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="p95"
          name="P95"
          stroke="#f59e0b"
          fill="url(#colorP95)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="p99"
          name="P99"
          stroke="#ef4444"
          fill="url(#colorP99)"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Recharts is heavy SVG — skip re-renders when the data array is reference-equal.
export const LatencyChart = memo(LatencyChartImpl);
