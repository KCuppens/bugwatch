'use client';

import { useState, Fragment } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Crown, Sparkles, Loader2 } from 'lucide-react';
import { usePaywall } from '@/lib/paywall-context';
import { useTier, getTierDisplayName, getFeatureTier, type Tier } from '@/hooks/use-feature';
import {
  TIER_PRICING,
  FEATURE_COMPARISON,
  TIER_ORDER,
  getAnnualSavings,
} from '@/lib/pricing-data';
import { billingApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// Feature name mapping for display
const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  webhooks: 'Webhook Alerts',
  pagerduty: 'PagerDuty Integration',
  opsgenie: 'OpsGenie Integration',
  slack_advanced: 'Advanced Slack Features',
  slack: 'Slack Integration',
  session_replay: 'Session Replay',
  performance_monitoring: 'Performance Monitoring',
  jira: 'Jira Integration',
  linear: 'Linear Integration',
  github: 'GitHub Integration',
  team_members: 'Team Members',
  sso: 'SSO/SAML',
  audit_logs: 'Audit Logs',
  custom_retention: 'Custom Retention',
};

function getFeatureDisplayName(feature: string): string {
  return FEATURE_DISPLAY_NAMES[feature] || feature;
}

export function PaywallModal() {
  const { isOpen, triggerFeature, targetTier, closePaywall } = usePaywall();
  const { tier: currentTier } = useTier();
  const [isAnnual, setIsAnnual] = useState(true);
  const [loadingTier, setLoadingTier] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Determine which tier to highlight based on trigger
  const recommendedTier = targetTier || (triggerFeature ? getFeatureTier(triggerFeature) : 'pro');
  const annualSavings = getAnnualSavings('pro');

  const handleUpgrade = async (tier: Tier) => {
    setLoadingTier(tier);
    setError(null);
    try {
      const response = await billingApi.createCheckout(
        tier,
        1,
        isAnnual,
        `${window.location.origin}/dashboard/settings?tab=billing&success=true&session_id={CHECKOUT_SESSION_ID}`,
        `${window.location.origin}/dashboard/settings?tab=billing&canceled=true`
      );
      window.location.href = response.checkout_url;
    } catch (err) {
      console.error('Failed to create checkout:', err);
      setError('Failed to start checkout. Please try again.');
      setLoadingTier(null);
    }
  };

  const getPrice = (tier: Tier) => {
    const pricing = TIER_PRICING[tier];
    if (pricing.monthly === null) return null;
    return isAnnual ? pricing.annual : pricing.monthly;
  };

  const renderFeatureValue = (value: string | boolean) => {
    if (typeof value === 'boolean') {
      return value ? (
        <Check className="h-4 w-4 text-green-500 mx-auto" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
      );
    }
    return <span className="text-sm">{value}</span>;
  };

  // Plans to show in the modal (exclude free, show pro and team)
  const upgradeTiers: Tier[] = ['pro', 'team'];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closePaywall()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Crown className="h-8 w-8 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-2xl">
            {triggerFeature ? (
              <>Upgrade to unlock {getFeatureDisplayName(triggerFeature)}</>
            ) : (
              <>Upgrade your plan</>
            )}
          </DialogTitle>
          <DialogDescription>
            {triggerFeature ? (
              <>
                This feature requires a {getTierDisplayName(recommendedTier)} plan
                or higher.
              </>
            ) : (
              <>Get more features and higher limits with a paid plan.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-sm">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-800 dark:text-red-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Billing Toggle */}
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setIsAnnual(false)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                !isAnnual
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2',
                isAnnual
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Annual
              <Badge
                variant="secondary"
                className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
              >
                Save {annualSavings}%
              </Badge>
            </button>
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {upgradeTiers.map((tier) => {
            const pricing = TIER_PRICING[tier];
            const price = getPrice(tier);
            const isRecommended = tier === recommendedTier;
            const isCurrent = tier === currentTier;

            return (
              <div
                key={tier}
                className={cn(
                  'relative flex flex-col rounded-xl border p-5',
                  isRecommended && 'ring-2 ring-primary shadow-lg',
                  isCurrent && 'bg-muted/50'
                )}
              >
                {isRecommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">
                      <Sparkles className="h-3 w-3 mr-1" />
                      Recommended
                    </Badge>
                  </div>
                )}

                <div className={cn('mb-4', isRecommended && 'pt-2')}>
                  <h3 className="text-lg font-semibold">
                    {getTierDisplayName(tier)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {pricing.description}
                  </p>
                </div>

                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">${price}</span>
                    <span className="text-muted-foreground text-sm">
                      /seat/mo
                    </span>
                  </div>
                  {isAnnual && price !== null && (
                    <p className="text-xs text-muted-foreground">
                      Billed annually (${price * 12}/seat/year)
                    </p>
                  )}
                </div>

                <ul className="space-y-2 mb-4 flex-1">
                  {FEATURE_COMPARISON.filter((f) => f.category === 'limits').map(
                    (feature) => (
                      <li
                        key={feature.name}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <span className="text-muted-foreground">
                          {feature[tier]}
                        </span>
                        <span className="text-muted-foreground/60">
                          {feature.name.toLowerCase()}
                        </span>
                      </li>
                    )
                  )}
                </ul>

                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    className={cn('w-full', isRecommended && 'bg-primary')}
                    onClick={() => handleUpgrade(tier)}
                    disabled={loadingTier === tier}
                  >
                    {loadingTier === tier && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Upgrade to {getTierDisplayName(tier)}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Feature Comparison Table */}
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 border-b">
            <h4 className="text-sm font-medium">Full Feature Comparison</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 font-medium">Feature</th>
                  {TIER_ORDER.map((tier) => (
                    <th
                      key={tier}
                      className={cn(
                        'text-center py-2 px-4 font-medium',
                        tier === currentTier && 'bg-muted/50'
                      )}
                    >
                      {getTierDisplayName(tier)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['limits', 'features', 'support'] as const).map((category) => (
                  <Fragment key={category}>
                    <tr className="bg-muted/30">
                      <td
                        colSpan={5}
                        className="py-2 px-4 font-medium capitalize text-muted-foreground text-xs"
                      >
                        {category}
                      </td>
                    </tr>
                    {FEATURE_COMPARISON.filter((f) => f.category === category).map(
                      (feature) => (
                        <tr
                          key={feature.name}
                          className="border-b border-muted/50"
                        >
                          <td className="py-2 px-4 text-muted-foreground">
                            {feature.name}
                          </td>
                          {TIER_ORDER.map((tier) => (
                            <td
                              key={tier}
                              className={cn(
                                'text-center py-2 px-4',
                                tier === currentTier && 'bg-muted/50'
                              )}
                            >
                              {renderFeatureValue(feature[tier])}
                            </td>
                          ))}
                        </tr>
                      )
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Enterprise CTA */}
        <div className="text-center mt-4 text-sm text-muted-foreground">
          Need more?{' '}
          <a
            href="mailto:sales@bugwatch.dev"
            className="text-primary hover:underline"
          >
            Contact sales
          </a>{' '}
          for Enterprise pricing.
        </div>
      </DialogContent>
    </Dialog>
  );
}
