"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

const EventMarkers = memo(function EventMarkers({
  events,
  duration,
}: {
  events: { time: number; type: string }[];
  duration: number;
}) {
  return (
    <>
      {events.map((evt, i) => {
        const position = (evt.time / duration) * 100;
        if (position < 0 || position > 100) return null;
        const markerColor =
          evt.type === "error"
            ? "bg-red-500"
            : evt.type === "click"
              ? "bg-blue-500"
              : evt.type === "snapshot"
                ? "bg-yellow-500"
                : "bg-muted-foreground/30";
        return (
          <div
            key={`${evt.time}-${i}`}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity",
              markerColor
            )}
            style={{ left: `${position}%` }}
            title={`${evt.type} at ${Math.round(evt.time / 1000)}s`}
          />
        );
      })}
    </>
  );
});

interface ReplayTimelineProps {
  duration: number;
  currentTime: number;
  events: { time: number; type: string }[];
  onSeek?: (time: number) => void;
}

export function ReplayTimeline({ duration, currentTime, events, onSeek }: ReplayTimelineProps) {
  if (duration <= 0) {
    return <div className="h-2 rounded-full bg-surface-3" />;
  }

  const progress = Math.min((currentTime / duration) * 100, 100);
  const step = duration / 100;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Math.round(ratio * duration));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(duration, currentTime + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(duration);
    }
  };

  return (
    <div
      role="slider"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="relative h-6 flex items-center group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
    >
      {/* Track background */}
      <div className="absolute inset-x-0 h-2 rounded-full bg-surface-3 overflow-hidden">
        {/* Progress bar */}
        <div className="h-full bg-accent rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
      </div>

      {/* Event markers — memoized so they don't re-render on every currentTime tick */}
      <EventMarkers events={events} duration={duration} />

      {/* Playhead */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent border-2 border-background shadow-sm z-10"
        style={{ left: `${progress}%`, marginLeft: "-6px" }}
      />
    </div>
  );
}
