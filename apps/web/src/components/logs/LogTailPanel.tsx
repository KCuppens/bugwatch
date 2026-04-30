'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { LogLevelBadge } from './LogLevelBadge';
import { Button } from '@/components/ui/button';
import { Play, Square, Trash2 } from 'lucide-react';
import type { LogEntry } from '@/lib/api';

const API_BASE_URL =
  process.env.NODE_ENV === 'development' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '');

interface LogTailPanelProps {
  projectId: string;
  isActive: boolean;
  onToggle: () => void;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

export function LogTailPanel({ projectId, isActive, onToggle }: LogTailPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const since = new Date().toISOString();
    const url = `${API_BASE_URL}/api/v1/projects/${projectId}/logs/tail?since=${encodeURIComponent(since)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const entry: LogEntry = JSON.parse(event.data) as LogEntry;
        setEntries((prev) => [entry, ...prev].slice(0, 200));
      } catch {
        // Ignore parse errors from malformed SSE data
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; we don't need to manually handle this
    };

    return () => {
      es.close();
    };
  }, [isActive, projectId]);

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/10 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              isActive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'
            )}
          />
          <span className="text-xs font-medium">
            {isActive ? 'Live Tail — streaming' : 'Live Tail — paused'}
          </span>
          {entries.length > 0 && (
            <span className="text-xs text-muted-foreground">({entries.length} entries)</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setEntries([])}
            disabled={entries.length === 0}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onToggle}>
            {isActive ? (
              <>
                <Square className="h-3 w-3 mr-1 fill-current" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1 fill-current" />
                Resume
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Entry list */}
      <div
        ref={listRef}
        className="h-64 overflow-y-auto font-mono text-xs bg-black/5"
        aria-label="Live log tail"
        aria-live="polite"
        aria-atomic="false"
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {isActive ? 'Waiting for log entries...' : 'Press Resume to start streaming logs.'}
          </div>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li
                key={`${entry.id}-${entry.timestamp}`}
                className="flex items-start gap-2 px-3 py-1 border-b border-white/5 hover:bg-white/5"
              >
                <span className="text-muted-foreground whitespace-nowrap shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <LogLevelBadge level={entry.level} className="shrink-0" />
                <span className="truncate text-foreground/90">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
