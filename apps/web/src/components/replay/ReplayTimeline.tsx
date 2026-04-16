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
              markerColor,
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
}

export function ReplayTimeline({
  duration,
  currentTime,
  events,
}: ReplayTimelineProps) {
  if (duration <= 0) {
    return (
      <div className="h-2 rounded-full bg-surface-3" />
    );
  }

  const progress = Math.min((currentTime / duration) * 100, 100);

  return (
    <div className="relative h-6 flex items-center group">
      {/* Track background */}
      <div className="absolute inset-x-0 h-2 rounded-full bg-surface-3 overflow-hidden">
        {/* Progress bar */}
        <div
          className="h-full bg-accent rounded-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
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
