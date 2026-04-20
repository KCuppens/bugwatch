"use client";

import { useState } from "react";
import { BellOff, Clock, X } from "lucide-react";
import { alertsApi } from "@/lib/api";
import { toast } from "sonner";

interface MuteSchedulerProps {
  ruleId: string;
  projectId: string;
  isMuted: boolean;
  mutedUntil?: string | null;
  onMuteChange: () => void;
}

const PRESET_DURATIONS = [
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
];

export function MuteScheduler({ ruleId, projectId, isMuted, mutedUntil, onMuteChange }: MuteSchedulerProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("");
  const [loading, setLoading] = useState(false);

  const handleMute = async (minutes: number) => {
    setLoading(true);
    try {
      await alertsApi.muteRule(projectId, ruleId, minutes);
      toast.success(`Alert muted for ${formatDuration(minutes)}`);
      setShowOptions(false);
      setCustomMinutes("");
      onMuteChange();
    } catch {
      toast.error("Failed to mute alert rule");
    } finally {
      setLoading(false);
    }
  };

  const handleUnmute = async () => {
    setLoading(true);
    try {
      await alertsApi.unmuteRule(projectId, ruleId);
      toast.success("Alert unmuted");
      onMuteChange();
    } catch {
      toast.error("Failed to unmute alert rule");
    } finally {
      setLoading(false);
    }
  };

  const handleCustomMute = () => {
    const mins = parseInt(customMinutes, 10);
    if (isNaN(mins) || mins <= 0) {
      toast.error("Enter a valid number of minutes");
      return;
    }
    handleMute(mins);
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
  };

  const getRemainingTime = (): string | null => {
    if (!mutedUntil) return null;
    const until = new Date(mutedUntil);
    const now = new Date();
    const diffMs = until.getTime() - now.getTime();
    if (diffMs <= 0) return null;
    const diffMin = Math.ceil(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m remaining`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m remaining`;
    return `${Math.floor(diffMin / 1440)}d remaining`;
  };

  if (isMuted) {
    const remaining = getRemainingTime();
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-500">
          <BellOff className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Muted</span>
          {remaining && <span className="text-xs text-amber-400/70">{remaining}</span>}
        </div>
        <button
          onClick={handleUnmute}
          disabled={loading}
          className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-colors disabled:opacity-50"
        >
          Unmute
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowOptions(!showOptions)}
        className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-colors"
      >
        <BellOff className="h-3.5 w-3.5" />
        Mute
      </button>

      {showOptions && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mute duration"
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowOptions(false);
          }}
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-subtle bg-surface-1 p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Mute Duration</span>
            <button onClick={() => setShowOptions(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            {PRESET_DURATIONS.map((preset) => (
              <button
                key={preset.minutes}
                onClick={() => handleMute(preset.minutes)}
                disabled={loading}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Clock className="h-3.5 w-3.5" />
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-2 border-t border-border-subtle pt-2">
            <label className="text-xs text-muted-foreground mb-1 block">Custom (minutes)</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                placeholder="e.g. 120"
                min={1}
                className="flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent-2 focus:outline-none"
              />
              <button
                onClick={handleCustomMute}
                disabled={loading || !customMinutes}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                Mute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
