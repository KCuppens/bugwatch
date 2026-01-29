'use client';

import { useState, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Crown, Sparkles, AlertCircle } from 'lucide-react';
import { billingApi } from '@/lib/api';
import { getTierDisplayName, type Tier } from '@/hooks/use-feature';
import {
  TIER_PRICING,
  FEATURE_COMPARISON,
  TIER_ORDER,
  isUpgrade,
  getAnnualSavings
} from '@/lib/pricing-data';
import { cn } from '@/lib/utils';

interface PricingTableProps {
  currentTier: Tier;
  isOwner: boolean;
}

export function PricingTable({ currentTier, isOwner }: PricingTableProps) {
  const [isAnnual, setIsAnnual] = useState(false);
  const [loadingTier, setLoadingTier] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async (tier: Tier) => {
    if (!isOwner || tier === currentTier) return;

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
    } finally {
      setLoadingTier(null);
    }
  };

  const renderFeatureValue = (value: string | boolean) => {
    if (typeof value === 'boolean') {
      return value ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/40" />
      );
    }
    return <span className="text-sm">{value}</span>;
  };

  const getPrice = (tier: Tier) => {
    const pricing = TIER_PRICING[tier];
    if (pricing.monthly === null) return null;
    return isAnnual ? pricing.annual : pricing.monthly;
  };

  const annualSavings = getAnnualSavings('pro'); // All tiers have same % savings

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-600 hover:text-red-800 dark:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header with Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Choose Your Plan</h3>
          <p className="text-sm text-muted-foreground">
            Select the plan that best fits your needs
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setIsAnnual(false)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md transition-colors",
              !isAnnual
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setIsAnnual(true)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2",
              isAnnual
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Annual
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              Save {annualSavings}%
            </Badge>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {TIER_ORDER.map((tier) => {
          const pricing = TIER_PRICING[tier];
          const price = getPrice(tier);
          const isCurrent = tier === currentTier;
          const canUpgrade = isUpgrade(currentTier, tier);
          const isPopular = pricing.popular;

          return (
            <Card
              key={tier}
              className={cn(
                "relative flex flex-col",
                isPopular && "ring-2 ring-primary shadow-lg",
                isCurrent && "bg-muted/50"
              )}
            >
              {/* Popular Badge */}
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Most Popular
                  </Badge>
                </div>
              )}

              <CardHeader className={cn("pb-4", isPopular && "pt-6")}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    {tier === 'enterprise' && <Crown className="h-4 w-4 text-amber-500" />}
                    {getTierDisplayName(tier)}
                  </CardTitle>
                  {isCurrent && (
                    <Badge variant="outline" className="text-xs">Current</Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  {pricing.description}
                </CardDescription>

                {/* Price */}
                <div className="pt-2">
                  {price !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">${price}</span>
                      <span className="text-muted-foreground text-sm">
                        /seat/{isAnnual ? 'mo' : 'month'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold">Custom</div>
                  )}
                  {isAnnual && price !== null && price > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Billed annually (${price * 12}/seat/year)
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col">
                {/* Key Features */}
                <ul className="space-y-2 mb-6 flex-1">
                  {FEATURE_COMPARISON.filter(f => f.category === 'limits').map((feature) => (
                    <li key={feature.name} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="text-muted-foreground">
                        {feature[tier]}
                      </span>
                      <span className="text-muted-foreground/60">{feature.name.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current Plan
                  </Button>
                ) : tier === 'enterprise' ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open('mailto:sales@bugwatch.dev', '_blank')}
                  >
                    Contact Sales
                  </Button>
                ) : canUpgrade ? (
                  <Button
                    className={cn("w-full", isPopular && "bg-primary")}
                    onClick={() => handleUpgrade(tier)}
                    disabled={!isOwner || loadingTier === tier}
                  >
                    {loadingTier === tier && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Upgrade to {getTierDisplayName(tier)}
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" disabled>
                    Downgrade via Manage Billing
                  </Button>
                )}

                {!isOwner && canUpgrade && tier !== 'enterprise' && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Only organization owners can upgrade
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Full Feature Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 pr-4 font-medium">Feature</th>
                  {TIER_ORDER.map((tier) => (
                    <th key={tier} className={cn(
                      "text-center py-3 px-4 font-medium",
                      tier === currentTier && "bg-muted/50"
                    )}>
                      {getTierDisplayName(tier)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Group by category */}
                {(['limits', 'features', 'support'] as const).map((category) => (
                  <Fragment key={category}>
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="py-2 px-2 font-medium capitalize text-muted-foreground text-xs">
                        {category}
                      </td>
                    </tr>
                    {FEATURE_COMPARISON
                      .filter((f) => f.category === category)
                      .map((feature) => (
                        <tr key={feature.name} className="border-b border-muted/50">
                          <td className="py-3 pr-4 text-muted-foreground">{feature.name}</td>
                          {TIER_ORDER.map((tier) => (
                            <td key={tier} className={cn(
                              "text-center py-3 px-4",
                              tier === currentTier && "bg-muted/50"
                            )}>
                              {renderFeatureValue(feature[tier])}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
