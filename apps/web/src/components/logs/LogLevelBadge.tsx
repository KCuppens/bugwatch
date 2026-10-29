'use client';

import { cn } from '@/lib/utils';

interface LogLevelBadgeProps {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  className?: string;
}

const LEVEL_STYLES: Record<LogLevelBadgeProps['level'], string> = {
  trace: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  debug: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  fatal: 'bg-red-900 text-red-100',
};

export function LogLevelBadge({ level, className }: LogLevelBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        LEVEL_STYLES[level],
        className
      )}
    >
      {level}
    </span>
  );
}
