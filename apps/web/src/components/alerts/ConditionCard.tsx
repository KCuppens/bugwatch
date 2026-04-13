'use client';

import { AlertTriangle, Activity, Server, Wifi, WifiOff, HardDrive, Cpu, MemoryStick, Trash2 } from 'lucide-react';
import { AlertCondition } from '@/lib/api';

interface ConditionCardProps {
  condition: AlertCondition;
  onChange: (c: AlertCondition) => void;
  onRemove?: () => void;
}

const CONDITION_TYPES = [
  { value: 'new_issue', label: 'New Issue', icon: AlertTriangle },
  { value: 'issue_frequency', label: 'Issue Frequency', icon: Activity },
  { value: 'monitor_down', label: 'Monitor Down', icon: WifiOff },
  { value: 'monitor_recovery', label: 'Monitor Recovery', icon: Wifi },
  { value: 'server_cpu_high', label: 'High CPU', icon: Cpu },
  { value: 'server_memory_high', label: 'High Memory', icon: MemoryStick },
  { value: 'server_disk_high', label: 'High Disk Usage', icon: HardDrive },
  { value: 'server_offline', label: 'Server Offline', icon: Server },
] as const;

function getDefaultCondition(type: string): AlertCondition {
  switch (type) {
    case 'new_issue':
      return { type: 'new_issue' };
    case 'issue_frequency':
      return { type: 'issue_frequency', threshold: 10, window_minutes: 60 };
    case 'monitor_down':
      return { type: 'monitor_down' };
    case 'monitor_recovery':
      return { type: 'monitor_recovery' };
    case 'server_cpu_high':
      return { type: 'server_cpu_high', threshold_percent: 90 };
    case 'server_memory_high':
      return { type: 'server_memory_high', threshold_percent: 90 };
    case 'server_disk_high':
      return { type: 'server_disk_high', threshold_percent: 90 };
    case 'server_offline':
      return { type: 'server_offline', missing_minutes: 5 };
    default:
      return { type: 'new_issue' };
  }
}

export function ConditionCard({ condition, onChange, onRemove }: ConditionCardProps) {
  const TypeIcon = CONDITION_TYPES.find((t) => t.value === condition.type)?.icon || AlertTriangle;

  const handleTypeChange = (newType: string) => {
    onChange(getDefaultCondition(newType));
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-surface-3 p-1.5">
          <TypeIcon className="h-4 w-4 text-text-secondary" />
        </div>

        <div className="flex-1 space-y-3">
          {/* Type selector */}
          <div>
            <label className="text-xs text-text-tertiary mb-1 block">Condition Type</label>
            <select
              value={condition.type}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
            >
              {CONDITION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Type-specific inputs */}
          {condition.type === 'new_issue' && (
            <div>
              <label className="text-xs text-text-tertiary mb-1 block">Level Filter (optional)</label>
              <select
                value={condition.level || ''}
                onChange={(e) =>
                  onChange({ ...condition, level: e.target.value || undefined })
                }
                className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
              >
                <option value="">All levels</option>
                <option value="fatal">Fatal</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
          )}

          {condition.type === 'issue_frequency' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-tertiary mb-1 block">Threshold (events)</label>
                <input
                  type="number"
                  value={condition.threshold}
                  onChange={(e) =>
                    onChange({
                      ...condition,
                      threshold: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  min={1}
                  className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary mb-1 block">Window (minutes)</label>
                <input
                  type="number"
                  value={condition.window_minutes}
                  onChange={(e) =>
                    onChange({
                      ...condition,
                      window_minutes: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  min={1}
                  className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
                />
              </div>
            </div>
          )}

          {(condition.type === 'server_cpu_high' ||
            condition.type === 'server_memory_high' ||
            condition.type === 'server_disk_high') && (
            <div>
              <label className="text-xs text-text-tertiary mb-1 block">Threshold (%)</label>
              <input
                type="number"
                value={condition.threshold_percent}
                onChange={(e) =>
                  onChange({
                    ...condition,
                    threshold_percent: parseFloat(e.target.value) || 0,
                  })
                }
                min={0}
                max={100}
                step={1}
                className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
              />
            </div>
          )}

          {condition.type === 'server_offline' && (
            <div>
              <label className="text-xs text-text-tertiary mb-1 block">Missing Duration (minutes)</label>
              <input
                type="number"
                value={condition.missing_minutes ?? 5}
                onChange={(e) =>
                  onChange({
                    ...condition,
                    missing_minutes: parseInt(e.target.value, 10) || 5,
                  })
                }
                min={1}
                className="w-full rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-foreground focus:border-accent-2 focus:outline-none"
              />
            </div>
          )}
        </div>

        {onRemove && (
          <button
            onClick={onRemove}
            className="mt-0.5 rounded-md p-1.5 text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
