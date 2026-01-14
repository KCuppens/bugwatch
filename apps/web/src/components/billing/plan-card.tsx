'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Crown, Check, ExternalLink } from 'lucide-react';
import { billingApi, type Subscription, type Organization } from '@/lib/api';
import { getTierDisplayName, getTierPrice, getTierRateLimit, type Tier } from '@/hooks/use-feature';

interface PlanCardProps {
  organization: Organization | null;
  subscription: Subscription | null;
  isOwner: boolean;
  onRefresh: () => void;
}

const TIER_FEATURES: Record<Tier, string[]> = {
  free: [
    '5 events/minute',
    '1 project',
    'Email alerts',
    '7-day retention',
  ],
  pro: [
    '60 events/minute',
    'Unlimited projects',
    'Webhook alerts',
    'Slack integration',
    '30-day retention',
    '10 AI fixes/month included',
  ],
  team: [
    '300 events/minute',
    'Unlimited projects',
    'All Pro features',
    'Team members',
    'Jira, Linear, GitHub',
    '90-day retention',
    '50 AI fixes/month included',
  ],
  enterprise: [
    '3,000+ events/minute',
    'Unlimited everything',
    'All Team features',
    'SSO/SAML',
    'Audit logs',
    'Custom retention',
    'Dedicated support',
  ],
};

export function PlanCard({ organization, subscription, isOwner, onRefresh: _onRefresh }: PlanCardProps) {
  const [loading, setLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState<Tier | null>(null);

  const currentTier = (organization?.tier || 'free') as Tier;

  const handleManageBilling = async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const response = await billingApi.createPortal(window.location.href);
      window.location.href = response.portal_url;
    } catch (error) {
      console.error('Failed to open billing portal:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (tier: Tier) => {
    if (!isOwner) return;
    setUpgradeLoading(tier);
    try {
      const response = await billingApi.createCheckout(
        tier,
        1, // seats
        false, // monthly
        `${window.location.origin}/dashboard/settings?tab=billing&success=true`,
        `${window.location.origin}/dashboard/settings?tab=billing&canceled=true`
      );
      window.location.href = response.checkout_url;
    } catch (error) {
      console.error('Failed to create checkout:', error);
    } finally {
      setUpgradeLoading(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Current Plan
                <Badge variant={currentTier === 'free' ? 'secondary' : 'default'}>
                  {getTierDisplayName(currentTier)}
                </Badge>
              </CardTitle>
              <CardDescription>
                {currentTier === 'free'
                  ? 'Upgrade to unlock more features'
                  : `${getTierRateLimit(currentTier).toLocaleString()} events/minute`}
              </CardDescription>
            </div>
            {subscription?.has_stripe && isOwner && (
              <Button variant="outline" onClick={handleManageBilling} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Manage Billing
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {subscription && subscription.current_period_end && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {subscription.cancel_at_period_end ? 'Cancels on' : 'Renews on'}
                </span>
                <span className={subscription.cancel_at_period_end ? 'text-amber-600' : ''}>
                  {formatDate(subscription.current_period_end)}
                </span>
              </div>
            )}
            {subscription?.billing_interval && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Billing</span>
                <span className="capitalize">{subscription.billing_interval}</span>
              </div>
            )}
            {organization && organization.seats > 1 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seats</span>
                <span>{organization.seats}</span>
              </div>
            )}
            <div className="pt-2">
              <p className="text-sm font-medium mb-2">Included features:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                {TIER_FEATURES[currentTier].map((feature, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Upgrades */}
      {currentTier !== 'enterprise' && isOwner && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Available Plans</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {(['pro', 'team', 'enterprise'] as Tier[]).map((tier) => {
              const isCurrentTier = tier === currentTier;
              const isDowngrade = ['free', 'pro', 'team', 'enterprise'].indexOf(tier) <
                ['free', 'pro', 'team', 'enterprise'].indexOf(currentTier);

              if (isDowngrade) return null;

              return (
                <Card
                  key={tier}
                  className={isCurrentTier ? 'border-primary' : ''}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {tier === 'enterprise' && <Crown className="h-4 w-4 text-amber-500" />}
                        {getTierDisplayName(tier)}
                      </CardTitle>
                      {isCurrentTier && (
                        <Badge variant="outline">Current</Badge>
                      )}
                    </div>
                    <CardDescription>
                      {tier === 'enterprise' ? (
                        'Custom pricing'
                      ) : (
                        <>
                          <span className="text-2xl font-bold text-foreground">
                            ${getTierPrice(tier)}
                          </span>
                          <span className="text-muted-foreground">/seat/month</span>
                        </>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                      {TIER_FEATURES[tier].slice(0, 4).map((feature, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <Check className="h-3 w-3 text-green-500" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {!isCurrentTier && (
                      <Button
                        className="w-full"
                        variant={tier === 'enterprise' ? 'outline' : 'default'}
                        onClick={() => tier === 'enterprise'
                          ? window.open('mailto:sales@bugwatch.dev', '_blank')
                          : handleUpgrade(tier)
                        }
                        disabled={upgradeLoading === tier}
                      >
                        {upgradeLoading === tier && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        {tier === 'enterprise' ? 'Contact Sales' : 'Upgrade'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
