'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Crown, Sparkles, X } from 'lucide-react';
import { getTierDisplayName, getFeatureTier, type Tier } from '@/hooks/use-feature';
import { usePaywall } from '@/lib/paywall-context';

interface UpgradePromptProps {
  feature: string;
  requiredTier: Tier;
  currentTier: string;
  onUpgrade?: () => void;
  dismissable?: boolean;
  variant?: 'card' | 'inline' | 'banner';
}

export function UpgradePrompt({
  feature,
  requiredTier,
  currentTier,
  onUpgrade,
  dismissable = true,
  variant = 'card',
}: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const { openPaywall } = usePaywall();

  if (dismissed) return null;

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      openPaywall({ feature, targetTier: getFeatureTier(feature) });
    }
  };

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Crown className="h-3 w-3 text-amber-500" />
        <span>
          Requires {getTierDisplayName(requiredTier)} plan.{' '}
          <button
            onClick={handleUpgrade}
            className="text-primary hover:underline font-medium"
          >
            Upgrade
          </button>
        </span>
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Crown className="h-5 w-5 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Unlock {feature}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Available on {getTierDisplayName(requiredTier)} and above
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleUpgrade}>
            <Sparkles className="h-3 w-3 mr-1" />
            Upgrade
          </Button>
          {dismissable && (
            <button
              onClick={() => setDismissed(true)}
              className="text-amber-400 hover:text-amber-600 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900">
          <Crown className="h-4 w-4 text-amber-600" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-amber-900 dark:text-amber-100">
            Upgrade to {getTierDisplayName(requiredTier)}
          </h4>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            {feature} requires {getTierDisplayName(requiredTier)} plan or higher.
            You&apos;re currently on {getTierDisplayName(currentTier)}.
          </p>
          <Button size="sm" className="mt-3" onClick={handleUpgrade}>
            <Sparkles className="h-3 w-3 mr-1" />
            Upgrade Now
          </Button>
        </div>
        {dismissable && (
          <button
            onClick={() => setDismissed(true)}
            className="text-amber-400 hover:text-amber-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </Card>
  );
}

/**
 * A wrapper component that conditionally renders children or an upgrade prompt
 */
interface FeatureGateProps {
  feature: string;
  requiredTier: Tier;
  currentTier: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({
  feature,
  requiredTier,
  currentTier,
  children,
  fallback,
}: FeatureGateProps) {
  const tierLevels: Record<string, number> = {
    free: 0,
    pro: 1,
    team: 2,
    enterprise: 3,
  };

  const currentLevel = tierLevels[currentTier] ?? 0;
  const requiredLevel = tierLevels[requiredTier] ?? 0;
  const hasAccess = currentLevel >= requiredLevel;

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <UpgradePrompt
      feature={feature}
      requiredTier={requiredTier}
      currentTier={currentTier}
    />
  );
}
