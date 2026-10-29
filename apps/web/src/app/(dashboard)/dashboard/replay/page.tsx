"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Video, Clock, Monitor, User, ChevronLeft, ChevronRight, Loader2, Lock, HardDrive } from "lucide-react";
import { replayApi, type SessionRecording } from "@/lib/api";
import { useFeature } from "@/hooks/use-feature";
import { usePaywall } from "@/lib/paywall-context";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";

function formatDuration(ms?: number): string {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "--";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function ReplayPageContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const hasReplay = useFeature("session_replay");
  const { openPaywall } = usePaywall();

  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedRecording, setSelectedRecording] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    if (!projectId || !hasReplay) {
      setLoading(false);
      return;
    }
    async function fetchRecordings() {
      setLoading(true);
      setFetchError(false);
      try {
        const response = await replayApi.listRecordings(projectId!, limit, page * limit);
        setRecordings(response.data);
        setTotal(response.total);
      } catch {
        setRecordings([]);
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchRecordings();
  }, [projectId, page, hasReplay]);

  if (!hasReplay) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="rounded-full bg-surface-3 p-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="font-display text-heading-md">Session Replay</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Watch real user sessions to understand exactly what happened before an error. Available on the Team plan and
          above.
        </p>
        <Button onClick={() => openPaywall()}>Upgrade to Team</Button>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Select a project to view session replays.</p>
      </div>
    );
  }

  // If a recording is selected, show the player
  if (selectedRecording) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelectedRecording(null)} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Back to recordings
        </Button>
        <ReplayPlayer recordingId={selectedRecording} projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-heading-lg">Session Replays</h1>
        <p className="text-body-sm text-muted-foreground mt-1">
          Watch real user sessions to understand exactly what happened before an error.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : fetchError ? (
        <Card className="bg-surface-2 border border-border-subtle">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-sm text-muted-foreground">Failed to load recordings. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : recordings.length === 0 ? (
        <Card className="bg-surface-2 border border-border-subtle">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="rounded-full bg-surface-3 p-4">
              <Video className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">No recordings yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Install the @bugwatch/replay SDK to start capturing session recordings. Recordings will appear here once
              users interact with your application.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-surface-2 border border-border-subtle">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Video className="h-4 w-4" />
                Recent Recordings
                <span className="ml-auto text-xs text-muted-foreground font-normal">{total} total</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Session</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Duration</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Segments</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Size</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Resolution</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Started</th>
                      <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordings.map((rec) => (
                      <tr
                        key={rec.id}
                        tabIndex={0}
                        aria-label={`Session ${rec.session_id}, ${formatDuration(rec.duration_ms)}`}
                        className="border-b border-border-subtle/50 hover:bg-surface-3/50 cursor-pointer transition-colors focus:outline-none focus-visible:bg-surface-3/50"
                        onClick={() => setSelectedRecording(rec.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedRecording(rec.id);
                          }
                        }}
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <Video className="h-3.5 w-3.5 text-accent" />
                            <span className="font-mono text-xs truncate max-w-[180px]">{rec.session_id}</span>
                          </div>
                          {rec.user_id && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />
                              {rec.user_id}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1 text-xs">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {formatDuration(rec.duration_ms)}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-xs">{rec.segment_count}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1 text-xs">
                            <HardDrive className="h-3 w-3 text-muted-foreground" />
                            {formatBytes(rec.total_size_bytes)}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-xs">
                          {rec.screen_width && rec.screen_height ? (
                            <div className="flex items-center gap-1">
                              <Monitor className="h-3 w-3 text-muted-foreground" />
                              {rec.screen_width}x{rec.screen_height}
                            </div>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground">{formatTime(rec.started_at)}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              rec.is_complete ? "bg-green-500/15 text-green-500" : "bg-yellow-500/15 text-yellow-500"
                            }`}
                          >
                            {rec.is_complete ? "Complete" : "Recording"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous page"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next page"
                  disabled={(page + 1) * limit >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense>
      <ReplayPageContent />
    </Suspense>
  );
}
