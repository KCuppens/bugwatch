'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { LogLevelBadge } from './LogLevelBadge';
import { Button } from '@/components/ui/button';
import { Link2, Unlink, ChevronDown, ChevronRight } from 'lucide-react';
import type { LogEntry } from '@/lib/api';

interface LogTableProps {
  logs: LogEntry[];
  onLinkToIssue?: (logId: string) => void;
  onUnlinkFromIssue?: (logId: string) => void;
  className?: string;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (!value || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
    return null;
  }
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground mb-1">{label}</dt>
      <dd>
        <pre className="text-xs bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      </dd>
    </div>
  );
}

function LogDetailPanel({
  entry,
  onLinkToIssue,
  onUnlinkFromIssue,
}: {
  entry: LogEntry;
  onLinkToIssue?: (logId: string) => void;
  onUnlinkFromIssue?: (logId: string) => void;
}) {
  return (
    <div className="bg-black/10 border-t border-border-subtle px-4 py-3 space-y-3">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {entry.logger_name && (
          <div>
            <dt className="text-xs text-muted-foreground">Logger</dt>
            <dd className="font-mono text-xs break-all">{entry.logger_name}</dd>
          </div>
        )}
        {entry.service_name && (
          <div>
            <dt className="text-xs text-muted-foreground">Service</dt>
            <dd className="font-mono text-xs">{entry.service_name}</dd>
          </div>
        )}
        {entry.environment && (
          <div>
            <dt className="text-xs text-muted-foreground">Environment</dt>
            <dd className="text-xs">{entry.environment}</dd>
          </div>
        )}
        {entry.release && (
          <div>
            <dt className="text-xs text-muted-foreground">Release</dt>
            <dd className="font-mono text-xs">{entry.release}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Log ID</dt>
          <dd className="font-mono text-xs break-all">{entry.log_id}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Timestamp</dt>
          <dd className="text-xs">{formatTimestamp(entry.timestamp)}</dd>
        </div>
      </dl>

      <div className="space-y-2">
        <JsonBlock label="Tags" value={entry.tags} />
        <JsonBlock label="Extra" value={entry.extra} />
        <JsonBlock label="Attributes" value={entry.attributes} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        {entry.issue_id ? (
          <>
            <span className="text-xs text-muted-foreground">
              Linked to issue <span className="font-mono">{entry.issue_id.slice(0, 8)}</span>
            </span>
            {onUnlinkFromIssue && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => onUnlinkFromIssue(entry.id)}
              >
                <Unlink className="h-3 w-3 mr-1" />
                Unlink
              </Button>
            )}
          </>
        ) : (
          onLinkToIssue && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => onLinkToIssue(entry.id)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              Link to Issue
            </Button>
          )
        )}
      </div>
    </div>
  );
}

export function LogTable({ logs, onLinkToIssue, onUnlinkFromIssue, className }: LogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No logs found. Adjust your filters or start sending logs using the SDK.</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border-subtle', className)}>
      <table className="w-full text-sm" aria-label="Log entries">
        <thead>
          <tr className="border-b border-border-subtle bg-black/10">
            <th scope="col" className="w-4 py-2 px-2" />
            <th scope="col" className="text-left py-2 px-3 font-medium text-muted-foreground text-xs w-20">
              Level
            </th>
            <th scope="col" className="text-left py-2 px-3 font-medium text-muted-foreground text-xs w-36">
              Timestamp
            </th>
            <th scope="col" className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">
              Message
            </th>
            <th scope="col" className="text-left py-2 px-3 font-medium text-muted-foreground text-xs w-28">
              Service
            </th>
            <th scope="col" className="text-left py-2 px-3 font-medium text-muted-foreground text-xs w-24">
              Env
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((entry) => {
            const isExpanded = expandedId === entry.id;
            return (
              <>
                <tr
                  key={entry.id}
                  className={cn(
                    'border-b border-border-subtle cursor-pointer hover:bg-white/5 transition-colors',
                    isExpanded && 'bg-white/5'
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  aria-expanded={isExpanded}
                >
                  <td className="py-2 px-2 text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <LogLevelBadge level={entry.level} />
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className="py-2 px-3 max-w-0">
                    <span className="block truncate">{entry.message}</span>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground truncate">
                    {entry.service_name ?? '—'}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground truncate">
                    {entry.environment ?? '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${entry.id}-detail`} className="border-b border-border-subtle">
                    <td colSpan={6} className="p-0">
                      <LogDetailPanel
                        entry={entry}
                        onLinkToIssue={onLinkToIssue}
                        onUnlinkFromIssue={onUnlinkFromIssue}
                      />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
