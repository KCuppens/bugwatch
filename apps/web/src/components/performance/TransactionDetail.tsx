"use client";

import { cn } from "@/lib/utils";

interface SpanItem {
  span_id: string;
  parent_span_id?: string;
  op: string;
  description?: string;
  status?: string;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

interface TransactionDetailProps {
  transactionName: string;
  totalDuration: number;
  spans: SpanItem[];
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function getOpColor(op: string): string {
  if (op.startsWith("http")) return "bg-blue-500";
  if (op.startsWith("db")) return "bg-purple-500";
  if (op.startsWith("cache")) return "bg-green-500";
  if (op.startsWith("queue")) return "bg-yellow-500";
  if (op.startsWith("render")) return "bg-pink-500";
  return "bg-accent";
}

export function TransactionDetail({ transactionName, totalDuration, spans }: TransactionDetailProps) {
  if (spans.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No span data available
      </div>
    );
  }

  const earliestStart = Math.min(...spans.map(s => new Date(s.started_at).getTime()));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium truncate max-w-[400px]" title={transactionName}>
          {transactionName}
        </h4>
        <span className="text-xs text-muted-foreground">{formatMs(totalDuration)}</span>
      </div>

      {spans.map((span) => {
        const spanStart = new Date(span.started_at).getTime();
        const offsetPct = totalDuration > 0
          ? ((spanStart - earliestStart) / totalDuration) * 100
          : 0;
        const widthPct = totalDuration > 0
          ? Math.max((span.duration_ms / totalDuration) * 100, 1)
          : 100;

        return (
          <div key={span.span_id} className="flex items-center gap-3 py-1.5 group">
            <div className="w-24 shrink-0 text-right">
              <span className="text-[11px] font-mono text-muted-foreground">{span.op}</span>
            </div>
            <div className="flex-1 h-5 bg-surface-3 rounded relative overflow-hidden">
              <div
                className={cn(
                  "absolute h-full rounded transition-all",
                  span.status && span.status !== "ok" ? "bg-red-500/70" : getOpColor(span.op),
                  "opacity-70 group-hover:opacity-100"
                )}
                style={{
                  left: `${Math.min(offsetPct, 99)}%`,
                  width: `${Math.min(widthPct, 100 - offsetPct)}%`,
                }}
              />
            </div>
            <div className="w-16 shrink-0 text-right">
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                {formatMs(span.duration_ms)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
