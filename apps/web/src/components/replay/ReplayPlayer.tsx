"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, Loader2, Video, Clock, Monitor } from "lucide-react";
import { replayApi, type SessionRecording, type SegmentData } from "@/lib/api";
import { ReplayTimeline } from "./ReplayTimeline";
import { ReplayEventList } from "./ReplayEventList";

interface ReplayPlayerProps {
  recordingId: string;
  projectId: string;
}

export function ReplayPlayer({ recordingId, projectId }: ReplayPlayerProps) {
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [segments, setSegments] = useState<SegmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [events, setEvents] = useState<{ time: number; type: string }[]>([]);

  const playerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<unknown>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch recording metadata and segments
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [recResponse, segResponse] = await Promise.all([
          replayApi.getRecording(projectId, recordingId),
          replayApi.getSegments(projectId, recordingId),
        ]);
        setRecording(recResponse.data);
        setSegments(segResponse);

        // Extract events from decoded segments for timeline
        const allEvents: { time: number; type: string }[] = [];
        let baseTime = 0;
        for (const seg of segResponse) {
          try {
            const decoded = atob(seg.data);
            const parsed = JSON.parse(decoded) as Array<{
              timestamp?: number;
              type?: number;
            }>;
            for (const evt of parsed) {
              if (evt.timestamp) {
                if (baseTime === 0) baseTime = evt.timestamp;
                const relativeTime = evt.timestamp - baseTime;
                // rrweb event types: 2=FullSnapshot, 3=IncrementalSnapshot, 5=Custom
                let evtType = "dom";
                if (evt.type === 2) evtType = "snapshot";
                else if (evt.type === 5) evtType = "custom";
                allEvents.push({ time: relativeTime, type: evtType });
              }
            }
          } catch {
            // Skip malformed segments
          }
        }
        setEvents(allEvents);
      } catch {
        setError("Failed to load session recording.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [recordingId, projectId]);

  // Initialize rrweb-player when segments are loaded
  useEffect(() => {
    if (!segments.length || !playerRef.current) return;

    // Decode all segments into a single event array
    const allRrwebEvents: unknown[] = [];
    for (const seg of segments) {
      try {
        const decoded = atob(seg.data);
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          allRrwebEvents.push(...parsed);
        }
      } catch {
        // Skip malformed
      }
    }

    if (allRrwebEvents.length === 0) return;

    const MAX_EVENTS = 50_000;
    if (allRrwebEvents.length > MAX_EVENTS) {
      setError("Session recording is too large to replay.");
      return;
    }

    // Guard against the dynamic import resolving after the effect cleanup
    // fires (component unmounted mid-mount) — otherwise we'd leak the
    // player + the setInterval below.
    let cancelled = false;

    // Dynamically import rrweb-player to avoid SSR issues
    import("rrweb-player")
      .then(({ default: RRWebPlayer }) => {
        if (cancelled || !playerRef.current) return;
        // Clear previous player content safely
        while (playerRef.current.firstChild) {
          playerRef.current.removeChild(playerRef.current.firstChild);
        }

        const player = new RRWebPlayer({
          target: playerRef.current,
          props: {
            events: allRrwebEvents as import("@rrweb/types").eventWithTime[],
            width: 800,
            height: 450,
            autoPlay: false,
            showController: false, // We use our own controls
            speed,
          },
        });

        replayerRef.current = player;

        // Listen for time updates from the replayer
        const replayer = player.getReplayer();
        if (replayer) {
          timerRef.current = setInterval(() => {
            try {
              const meta = replayer.getMetaData();
              if (meta && meta.totalTime > 0) {
                const timer = replayer.timer;
                if (timer && typeof timer.timeOffset === "number") {
                  setCurrentTime(timer.timeOffset);
                }
              }
            } catch {
              // Ignore timer errors
            }
          }, 100);
        }
      })
      .catch(() => {
        // rrweb-player not available
      });

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (replayerRef.current && typeof (replayerRef.current as { $destroy?: () => void }).$destroy === "function") {
        (replayerRef.current as { $destroy: () => void }).$destroy();
        replayerRef.current = null;
      }
    };
  }, [segments]);

  const togglePlay = useCallback(() => {
    if (!replayerRef.current) return;
    const player = replayerRef.current as { toggle?: () => void };
    if (player.toggle) {
      player.toggle();
      setIsPlaying((p) => !p);
    }
  }, []);

  const setPlaybackSpeed = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
    if (replayerRef.current) {
      const player = replayerRef.current as { setSpeed?: (s: number) => void };
      if (player.setSpeed) player.setSpeed(newSpeed);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-2 border border-border-subtle">
        <CardContent className="flex flex-col items-center py-12 gap-2">
          <Video className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Recording info */}
      {recording && (
        <Card className="bg-surface-2 border border-border-subtle">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Video className="h-4 w-4 text-accent" />
              Session {recording.session_id}
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  recording.is_complete ? "bg-green-500/15 text-green-500" : "bg-yellow-500/15 text-yellow-500"
                }`}
              >
                {recording.is_complete ? "Complete" : "Recording"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {recording.duration_ms ? `${Math.round(recording.duration_ms / 1000)}s` : "--"}
              </div>
              {recording.screen_width && recording.screen_height && (
                <div className="flex items-center gap-1">
                  <Monitor className="h-3 w-3" />
                  {recording.screen_width}x{recording.screen_height}
                </div>
              )}
              <div>{recording.segment_count} segments</div>
              <div>{new Date(recording.started_at).toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Player area */}
        <div className="space-y-3">
          <Card className="bg-surface-2 border border-border-subtle overflow-hidden">
            <div ref={playerRef} className="w-full min-h-[450px] bg-black flex items-center justify-center">
              {segments.length === 0 && <p className="text-white/50 text-sm">No replay data available</p>}
            </div>
          </Card>

          {/* Playback controls */}
          <Card className="bg-surface-2 border border-border-subtle">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause replay" : "Play replay"}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>

                <div className="flex-1">
                  {recording && (
                    <ReplayTimeline
                      duration={recording.duration_ms || 0}
                      currentTime={currentTime}
                      events={events}
                      onSeek={setCurrentTime}
                    />
                  )}
                </div>

                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{Math.round(currentTime / 1000)}s</span>
                  <span>/</span>
                  <span>{recording?.duration_ms ? `${Math.round(recording.duration_ms / 1000)}s` : "--"}</span>
                </div>

                {/* Speed controls */}
                <div className="flex items-center gap-1 ml-2">
                  {[1, 2, 4, 8].map((s) => (
                    <Button
                      key={s}
                      variant={speed === s ? "default" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setPlaybackSpeed(s)}
                    >
                      {s}x
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Events sidebar */}
        <ReplayEventList events={events} currentTime={currentTime} />
      </div>
    </div>
  );
}
