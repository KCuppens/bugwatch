"use client";

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

interface ThroughputChartProps {
  data: TimeSeriesPoint[];
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThroughputChart({ data }: ThroughputChartProps) {
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
          <linearGradient id="colorThroughput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
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
          formatter={(value: number, name: string) => [
            name === "Errors" ? value : value.toFixed(1),
            name,
          ]}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="throughput"
          name="Throughput (requests)"
          stroke="hsl(var(--accent))"
          fill="url(#colorThroughput)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="error_count"
          name="Errors"
          stroke="#ef4444"
          fill="url(#colorErrors)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
