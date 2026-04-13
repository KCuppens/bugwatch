"use client";

import { useState, useEffect, useCallback } from "react";
import { overviewApi } from "@/lib/api";

interface SidebarCounts {
  unresolvedCount: number;
  monitorsDownCount: number;
}

export function useSidebarCounts() {
  const [counts, setCounts] = useState<SidebarCounts>({
    unresolvedCount: 0,
    monitorsDownCount: 0,
  });

  const fetchCounts = useCallback(async () => {
    try {
      const [statsRes, monitorsRes] = await Promise.all([
        overviewApi.getStatsByProject(),
        overviewApi.getMonitorsAcrossProjects().catch(() => ({
          data: [],
          summary: { total: 0, up: 0, down: 0 },
        })),
      ]);
      setCounts({
        unresolvedCount: statsRes.totals.unresolved,
        monitorsDownCount: monitorsRes.summary.down,
      });
    } catch {
      // Fail silently - badge counts are supplementary
    }
  }, []);

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
