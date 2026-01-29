'use client';

import { Crown } from 'lucide-react';
import { usePaywall } from '@/lib/paywall-context';
import { getFeatureTier, getTierDisplayName } from '@/hooks/use-feature';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ProBadgeProps {
  feature: string;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export function ProBadge({
  feature,
  className,
  showLabel = true,
  size = 'sm',
}: ProBadgeProps) {
  const { openPaywall } = usePaywall();
  const requiredTier = getFeatureTier(feature);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openPaywall({ feature, targetTier: requiredTier });
  };

  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors cursor-pointer',
            size === 'md' && 'px-2 py-1',
            className
          )}
        >
          <Crown className={sizeClasses[size]} />
          {showLabel && (
            <span
              className={cn('text-xs font-medium', size === 'md' && 'text-sm')}
            >
              {getTierDisplayName(requiredTier)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top" align="center">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Upgrade to {getTierDisplayName(requiredTier)}
          </p>
          <p className="text-xs text-muted-foreground">
            This feature requires a {getTierDisplayName(requiredTier)} plan or
            higher.
          </p>
          <button
            onClick={handleClick}
            className="text-xs text-primary hover:underline font-medium"
          >
            View plans and pricing
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline upgrade link for use in text contexts
 */
interface UpgradeLinkProps {
  feature?: string;
  children?: React.ReactNode;
  className?: string;
}

export function UpgradeLink({
  feature,
  children = 'Upgrade',
  className,
}: UpgradeLinkProps) {
  const { openPaywall } = usePaywall();
  const requiredTier = feature ? getFeatureTier(feature) : 'pro';

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openPaywall({ feature, targetTier: requiredTier });
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'text-primary hover:underline font-medium cursor-pointer',
        className
      )}
    >
      {children}
    </button>
  );
}
