"use client";

import { useState, useEffect, useCallback } from "react";
import { overviewApi, type ProjectStatsWithInfo } from "@/lib/api";

interface UseProjectStatsResult {
  stats: Map<string, ProjectStatsWithInfo>;
  isLoading: boolean;
}

/**
 * Wraps overviewApi.getStatsByProject() and returns a Map keyed by project_id
 * for O(1) lookup from the project selector. Refreshes every 60s. Fails silently —
 * consumers should render without badges if stats are missing.
 */
export function useProjectStats(): UseProjectStatsResult {
  const [stats, setStats] = useState<Map<string, ProjectStatsWithInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await overviewApi.getStatsByProject();
      const map = new Map<string, ProjectStatsWithInfo>();
      for (const row of res.data) {
        map.set(row.project_id, row);
      }
      setStats(map);
    } catch {
      // Fail silently — selector still works without badges
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, isLoading };
}
