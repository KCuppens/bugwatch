'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Zap, Bot, AlertTriangle } from 'lucide-react';
import { billingApi, type UsageRecord } from '@/lib/api';
import { getTierRateLimit, type Tier } from '@/hooks/use-feature';

interface UsageStatsProps {
  tier: Tier;
}

interface UsageData {
  usage: UsageRecord[];
  period_start: string;
  period_end: string;
}

export function UsageStats({ tier }: UsageStatsProps) {
  const [loading, setLoading] = useState(true);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsage() {
      try {
        const response = await billingApi.getUsage();
        setUsageData(response);
      } catch (err) {
        setError('Failed to load usage data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchUsage();
  }, []);

  const getUsageByMetric = (metric: string): number => {
    const record = usageData?.usage.find((u) => u.metric === metric);
    return record?.count || 0;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const eventsLimit = getTierRateLimit(tier) * 60 * 24 * 30; // Monthly estimate
  const eventsUsed = getUsageByMetric('events');
  const eventsPercent = Math.min((eventsUsed / eventsLimit) * 100, 100);

  const aiFixesIncluded = tier === 'free' ? 0 : tier === 'pro' ? 10 : tier === 'team' ? 50 : 100;
  const aiFixesUsed = getUsageByMetric('ai_fixes');
  const aiFixesPercent = aiFixesIncluded > 0 ? Math.min((aiFixesUsed / aiFixesIncluded) * 100, 100) : 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage This Period</CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-32" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage This Period</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage This Period</CardTitle>
        <CardDescription>
          {usageData && (
            <>
              {formatDate(usageData.period_start)} - {formatDate(usageData.period_end)}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Events */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">Events Ingested</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {eventsUsed.toLocaleString()} events
            </span>
          </div>
          <Progress value={eventsPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Rate limit: {getTierRateLimit(tier).toLocaleString()} events/minute
          </p>
        </div>

        {/* AI Fixes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">AI Fixes Used</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {aiFixesUsed} / {aiFixesIncluded > 0 ? aiFixesIncluded : 'Pay as you go'}
            </span>
          </div>
          {aiFixesIncluded > 0 && (
            <Progress value={aiFixesPercent} className="h-2" />
          )}
          <p className="text-xs text-muted-foreground">
            {aiFixesIncluded > 0
              ? `${aiFixesIncluded} included per month, then $1.50 each`
              : '$1.50 per AI fix (buy credits to use)'}
          </p>
        </div>

        {/* Monitors */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Monitor Checks</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {getUsageByMetric('monitor_checks').toLocaleString()} checks
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
