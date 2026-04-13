"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  MousePointer,
  Globe,
  AlertCircle,
  Camera,
  Code,
  List,
} from "lucide-react";

export interface ReplayEvent {
  time: number;
  type: string;
}

interface ReplayEventListProps {
  events: ReplayEvent[];
  currentTime: number;
}

function getEventIcon(type: string) {
  switch (type) {
    case "click":
      return MousePointer;
    case "navigation":
      return Globe;
    case "error":
      return AlertCircle;
    case "snapshot":
      return Camera;
    case "custom":
      return Code;
    default:
      return List;
  }
}

function getEventLabel(type: string): string {
  switch (type) {
    case "click":
      return "Click";
    case "navigation":
      return "Navigation";
    case "error":
      return "Error";
    case "snapshot":
      return "Full Snapshot";
    case "custom":
      return "Custom Event";
    case "dom":
      return "DOM Change";
    default:
      return type;
  }
}

function formatTimeOffset(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function ReplayEventList({ events, currentTime }: ReplayEventListProps) {
  // Only show significant events (skip frequent dom events)
  const significantEvents = events.filter(
    (e) => e.type !== "dom" || events.length < 100,
  );

  // Limit to last 200 events to prevent performance issues
  const displayEvents = significantEvents.slice(-200);

  return (
    <Card className="bg-surface-2 border border-border-subtle h-fit max-h-[600px] flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <List className="h-4 w-4" />
          Events
          <span className="ml-auto text-[10px] text-muted-foreground font-normal">
            {significantEvents.length} events
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-1">
        {displayEvents.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-muted-foreground">No events recorded</p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle/50">
            {displayEvents.map((evt, i) => {
              const Icon = getEventIcon(evt.type);
              const isPast = evt.time <= currentTime;
              const isCurrent =
                Math.abs(evt.time - currentTime) < 500;

              return (
                <div
                  key={`${evt.time}-${i}`}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 text-xs transition-colors",
                    isCurrent && "bg-accent/10",
                    !isPast && "opacity-40",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3 w-3 shrink-0",
                      evt.type === "error"
                        ? "text-red-500"
                        : evt.type === "click"
                          ? "text-blue-500"
                          : evt.type === "snapshot"
                            ? "text-yellow-500"
                            : "text-muted-foreground",
                    )}
                  />
                  <span className="flex-1 truncate">
                    {getEventLabel(evt.type)}
                  </span>
                  <span className="text-muted-foreground font-mono shrink-0">
                    {formatTimeOffset(evt.time)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
