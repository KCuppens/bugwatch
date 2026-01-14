"use client";

import { useState, useEffect, useCallback } from "react";

const HISTORY_KEY = "bugwatch:search:history";
const MAX_HISTORY = 20;

/**
 * Manages search history in localStorage
 */
export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
      }
    } catch {
      // Invalid JSON, clear it
      localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  const addToHistory = useCallback((query: string) => {
    if (!query.trim()) return;

    setHistory((prev) => {
      // Remove duplicates, add to front, trim to max
      const filtered = prev.filter((h) => h !== query);
      const updated = [query, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, []);

  const removeFromHistory = useCallback((query: string) => {
    setHistory((prev) => {
      const updated = prev.filter((h) => h !== query);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { history, addToHistory, clearHistory, removeFromHistory };
}
