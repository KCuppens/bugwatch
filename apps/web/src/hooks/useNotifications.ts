"use client";

import { useState, useEffect, useCallback } from "react";
import { overviewApi, type AlertLogWithProjectInfo } from "@/lib/api";

const LAST_SEEN_KEY = "bugwatch:notifications:lastSeen";

export function useNotifications() {
  const [notifications, setNotifications] = useState<AlertLogWithProjectInfo[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const getLastSeen = useCallback(() => {
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    return stored ? Number(stored) : 0;
  }, []);

  const markAllRead = useCallback(() => {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    setUnreadCount(0);
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await overviewApi.getAlertLogsAcrossProjects(20);
      setNotifications(res.data);
      const lastSeen = getLastSeen();
      const unread = res.data.filter(
        (n) => new Date(n.created_at).getTime() > lastSeen
      ).length;
      setUnreadCount(unread);
    } catch {
      // Fail silently
    }
  }, [getLastSeen]);

  useEffect(() => {
    fetchNotifications();
    let interval: ReturnType<typeof setInterval> | null = null;

    function handleVisibility() {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        fetchNotifications();
        if (!interval) interval = setInterval(fetchNotifications, 60000);
      }
    }

    if (!document.hidden) {
      interval = setInterval(fetchNotifications, 60000);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchNotifications]);

  return { notifications, unreadCount, markAllRead };
}
