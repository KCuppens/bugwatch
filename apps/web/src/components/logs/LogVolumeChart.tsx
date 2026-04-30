'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import type { LogStats } from '@/lib/api';

interface LogVolumeChartProps {
  stats: LogStats;
  className?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  fatal: '#7f1d1d',
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#64748b',
  trace: '#9ca3af',
};

function getDominantLevel(levelCounts?: Record<string, number>): string {
  if (!levelCounts) return 'info';
  const order = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
  for (const level of order) {
    if ((levelCounts[level] ?? 0) > 0) return level;
  }
  return 'info';
}

export function LogVolumeChart({ stats, className }: LogVolumeChartProps) {
  const data = stats.buckets.map((bucket) => ({
    name: `T-${stats.buckets.length - bucket.bucket_index}`,
    count: bucket.count,
    color: LEVEL_COLORS[getDominantLevel(bucket.level_counts)] ?? LEVEL_COLORS.info,
  }));

  return (
    <div className={cn('h-32', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a2e',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#888' }}
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          />
          <Bar
            dataKey="count"
            name="Log entries"
            radius={[2, 2, 0, 0]}
            fill="#3b82f6"
            // Per-bar coloring via Cell is handled by the shape prop below
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
