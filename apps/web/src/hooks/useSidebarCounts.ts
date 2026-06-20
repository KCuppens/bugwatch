"use client";

import { useState, useEffect, useCallback } from "react";
import { overviewApi, billingApi, projectsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type Tier } from "@/hooks/use-feature";

const PROJECT_LIMIT: Record<Tier, number | null> = {
  free: 1,
  pro: null,
  team: null,
  enterprise: null,
};

const MONITOR_LIMIT: Record<Tier, number | null> = {
  free: 1,
  pro: 10,
  team: 25,
  enterprise: null,
};

function countLimitWarnings(
  tier: Tier,
  projectTotal: number | null,
  monitorTotal: number | null,
  seatsUsed: number,
  seatsTotal: number,
): number {
  let count = 0;
  const threshold = 0.8;

  const projectLimit = PROJECT_LIMIT[tier];
  if (projectLimit !== null && projectTotal !== null && projectTotal / projectLimit >= threshold) count++;

  const monitorLimit = MONITOR_LIMIT[tier];
  if (monitorLimit !== null && monitorTotal !== null && monitorTotal / monitorLimit >= threshold) count++;

  if (seatsTotal > 0 && seatsUsed / seatsTotal >= threshold) count++;

  return count;
}

interface SidebarCounts {
  unresolvedCount: number;
  monitorsDownCount: number;
  limitsWarningCount: number;
}

export function useSidebarCounts() {
  const { user } = useAuth();
  const tier = (user?.organization?.tier ?? "free") as Tier;

  const [counts, setCounts] = useState<SidebarCounts>({
    unresolvedCount: 0,
    monitorsDownCount: 0,
    limitsWarningCount: 0,
  });

  const fetchCounts = useCallback(async () => {
    try {
      const [statsRes, monitorsRes, dashRes, projRes] = await Promise.all([
        overviewApi.getStatsByProject(),
        overviewApi.getMonitorsAcrossProjects().catch(() => ({
          data: [],
          summary: { total: 0, up: 0, down: 0 },
        })),
        billingApi.getBillingDashboard().catch(() => null),
        projectsApi.list(1, 1).catch(() => null),
      ]);
      setCounts({
        unresolvedCount: statsRes.totals.unresolved,
        monitorsDownCount: monitorsRes.summary.down,
        limitsWarningCount: countLimitWarnings(
          tier,
          projRes?.pagination.total ?? null,
          monitorsRes.summary.total,
          dashRes?.seats_used ?? 0,
          dashRes?.seats_total ?? 1,
        ),
      });
    } catch {
      // Fail silently - badge counts are supplementary
    }
  }, [tier]);

  useEffect(() => {
    fetchCounts();
    let interval: ReturnType<typeof setInterval> | null = null;

    function handleVisibility() {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        fetchCounts();
        if (!interval) interval = setInterval(fetchCounts, 60000);
      }
    }

    if (!document.hidden) {
      interval = setInterval(fetchCounts, 60000);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchCounts]);

  return counts;
}
