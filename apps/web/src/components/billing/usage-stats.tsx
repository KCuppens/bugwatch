"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Activity, Zap, AlertTriangle, RefreshCw } from "lucide-react";
import { billingApi, type UsageRecord } from "@/lib/api";
import { getTierRateLimit, type Tier } from "@/hooks/use-feature";

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

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await billingApi.getUsage();
      setUsageData(response);
    } catch (err) {
      setError("Failed to load usage data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // O(1) metric lookup via Map — avoids O(n) find on every render.
  const usageIndex = useMemo(() => new Map((usageData?.usage ?? []).map((u) => [u.metric, u])), [usageData]);

  const getUsageByMetric = (metric: string): number => {
    return usageIndex.get(metric)?.count ?? 0;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const eventsLimit = getTierRateLimit(tier) * 60 * 24 * 30; // Monthly estimate
  const eventsUsed = getUsageByMetric("events");
  const monitorChecks = getUsageByMetric("monitor_checks");
  const eventsPercent = eventsLimit > 0 ? Math.min((eventsUsed / eventsLimit) * 100, 100) : 0;

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
          <div role="alert" className="flex items-center justify-between gap-2 text-destructive">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchUsage}>
              <RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />
              Retry
            </Button>
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
            <span className="text-sm text-muted-foreground">{eventsUsed.toLocaleString()} events</span>
          </div>
          {eventsLimit === 0 ? (
            <p className="text-xs text-muted-foreground">Usage limit not available for this plan.</p>
          ) : (
            <Progress
              value={eventsPercent}
              className="h-2"
              aria-label={`Events ingested: ${eventsPercent.toFixed(0)}% of monthly limit`}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Rate limit: {getTierRateLimit(tier).toLocaleString()} events/minute
          </p>
        </div>

        {/* Monitors */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Monitor Checks</span>
            </div>
            <span className="text-sm text-muted-foreground">{monitorChecks.toLocaleString()} checks</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
