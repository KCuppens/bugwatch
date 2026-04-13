'use client';

import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';

interface ThresholdPreviewProps {
  threshold: number;
  data: { time: string; value: number }[];
  label: string;
}

export function ThresholdPreview({ threshold, data, label }: ThresholdPreviewProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
        <p className="text-xs text-text-tertiary text-center">No data available for preview</p>
      </div>
    );
  }

  const maxValue = Math.max(threshold * 1.2, ...data.map((d) => d.value));

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <span className="text-xs text-text-tertiary">
          Threshold: <span className="text-amber-500 font-medium">{threshold}</span>
        </span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="thresholdGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.2} />
                <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: 'hsl(var(--text-tertiary))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, maxValue]}
              tick={{ fontSize: 10, fill: 'hsl(var(--text-tertiary))' }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--surface-1))',
                border: '1px solid hsl(var(--border-subtle))',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              labelStyle={{ color: 'hsl(var(--text-secondary))' }}
            />
            <ReferenceLine
              y={threshold}
              stroke="hsl(var(--amber-500, #f59e0b))"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--brand))"
              fill="url(#thresholdGradient)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
