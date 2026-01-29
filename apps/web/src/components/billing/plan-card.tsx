'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Calendar, CreditCard, Users } from 'lucide-react';
import { billingApi, type Subscription, type Organization } from '@/lib/api';
import { getTierDisplayName, getTierRateLimit, type Tier } from '@/hooks/use-feature';

interface PlanCardProps {
  organization: Organization | null;
  subscription: Subscription | null;
  isOwner: boolean;
  onRefresh: () => void;
}

export function PlanCard({ organization, subscription, isOwner, onRefresh: _onRefresh }: PlanCardProps) {
  const [loading, setLoading] = useState(false);

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
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
                ? 'You are on the free plan'
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
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Billing Period */}
          {subscription && subscription.current_period_end && (
            <div className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {subscription.cancel_at_period_end ? 'Cancels' : 'Renews'}
                </p>
                <p className={`text-sm ${subscription.cancel_at_period_end ? 'text-amber-600' : 'text-muted-foreground'}`}>
                  {formatDate(subscription.current_period_end)}
                </p>
              </div>
            </div>
          )}

          {/* Billing Interval */}
          {subscription?.billing_interval && (
            <div className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Billing</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {subscription.billing_interval}
                </p>
              </div>
            </div>
          )}

          {/* Seats */}
          {organization && organization.seats > 0 && (
            <div className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Seats</p>
                <p className="text-sm text-muted-foreground">
                  {organization.seats} {organization.seats === 1 ? 'seat' : 'seats'}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
