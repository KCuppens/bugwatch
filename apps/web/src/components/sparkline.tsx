"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  className?: string;
  showTrend?: boolean;
}

type TrendDirection = "up" | "down" | "stable";

function calculateTrend(data: number[]): { direction: TrendDirection; percentage: number } {
  if (data.length < 2) return { direction: "stable", percentage: 0 };

  // Compare last third vs first third
  const thirdLength = Math.max(1, Math.floor(data.length / 3));
  const recentSum = data.slice(-thirdLength).reduce((a, b) => a + b, 0);
  const oldSum = data.slice(0, thirdLength).reduce((a, b) => a + b, 0);

  if (oldSum === 0 && recentSum === 0) {
    return { direction: "stable", percentage: 0 };
  }

  if (oldSum === 0) {
    return { direction: "up", percentage: 100 };
  }

  const percentChange = ((recentSum - oldSum) / oldSum) * 100;

  if (percentChange > 10) {
    return { direction: "up", percentage: Math.round(percentChange) };
  } else if (percentChange < -10) {
    return { direction: "down", percentage: Math.round(Math.abs(percentChange)) };
  }

  return { direction: "stable", percentage: 0 };
}

function getTrendLabel(trend: { direction: TrendDirection; percentage: number }): string {
  switch (trend.direction) {
    case "up":
      return `+${trend.percentage}%`;
    case "down":
      return `-${trend.percentage}%`;
    default:
      return "";
  }
}

function getTrendIcon(direction: TrendDirection): string {
  switch (direction) {
    case "up":
      return "↑";
    case "down":
      return "↓";
    default:
      return "→";
  }
}

export function Sparkline({
  data,
  width = 56,
  height = 16,
  barWidth = 6,
  gap = 2,
  className,
  showTrend = true,
}: SparklineProps) {
  const { normalizedData, trend } = useMemo(() => {
    const max = Math.max(...data, 1);
    const normalized = data.map((value) => (value / max) * height);
    const trendInfo = calculateTrend(data);
    return { normalizedData: normalized, trend: trendInfo };
  }, [data, height]);

  const trendColorClass = useMemo(() => {
    switch (trend.direction) {
      case "up":
        return "text-red-500";
      case "down":
        return "text-green-500";
      default:
        return "text-muted-foreground";
    }
  }, [trend.direction]);

  const barColorClass = useMemo(() => {
    switch (trend.direction) {
      case "up":
        return "fill-red-400";
      case "down":
        return "fill-green-400";
      default:
        return "fill-muted-foreground/50";
    }
  }, [trend.direction]);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="flex-shrink-0"
      >
        {normalizedData.map((barHeight, index) => (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={Math.max(barHeight, 1)}
            rx={1}
            className={barColorClass}
          />
        ))}
      </svg>
      {showTrend && (
        <span className={cn("text-xs font-medium whitespace-nowrap", trendColorClass)}>
          {getTrendIcon(trend.direction)}
          {trend.percentage > 0 && (
            <span className="ml-0.5">{getTrendLabel(trend)}</span>
          )}
        </span>
      )}
    </div>
  );
}

// Generate mock sparkline data based on issue metrics
export function generateSparklineData(
  count: number,
  firstSeen: string,
  _lastSeen?: string // Kept for API compatibility
): number[] {
  // Generate 7 buckets for visual simplicity
  const buckets = 7;
  const data: number[] = [];

  const firstSeenDate = new Date(firstSeen);
  // Handle invalid dates gracefully
  if (isNaN(firstSeenDate.getTime())) {
    return Array(buckets).fill(Math.max(1, Math.round(count / buckets)));
  }

  const now = new Date();
  const hoursDiff = Math.max(1, (now.getTime() - firstSeenDate.getTime()) / (1000 * 60 * 60));

  // If issue is very recent (< 24h), distribute events mostly in recent buckets
  const isRecent = hoursDiff < 24;

  // Create a distribution pattern based on how recent the issue is
  for (let i = 0; i < buckets; i++) {
    if (isRecent) {
      // More events in recent buckets for new issues
      const weight = Math.pow((i + 1) / buckets, 2);
      data.push(Math.max(0, Math.round((count * weight) / buckets + (Math.random() - 0.5) * 2)));
    } else {
      // More varied distribution for older issues
      const baseValue = count / buckets;
      const variance = Math.random() * baseValue * 0.8;
      data.push(Math.max(0, Math.round(baseValue + variance)));
    }
  }

  return data;
}

export default Sparkline;
