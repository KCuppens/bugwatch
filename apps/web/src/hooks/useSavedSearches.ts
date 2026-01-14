"use client";

import { useState, useEffect, useCallback } from "react";
import type { SavedSearch } from "@/lib/search";

const SAVED_SEARCHES_KEY = "bugwatch:search:saved";

/**
 * Manages saved searches in localStorage
 */
export function useSavedSearches(projectId: string | undefined) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // Load from localStorage
  useEffect(() => {
    if (!projectId) return;

    try {
      const stored = localStorage.getItem(SAVED_SEARCHES_KEY);
      if (stored) {
        const all: SavedSearch[] = JSON.parse(stored);
        setSavedSearches(all.filter((s) => s.projectId === projectId));
      }
    } catch {
      localStorage.removeItem(SAVED_SEARCHES_KEY);
    }
  }, [projectId]);

  const saveSearch = useCallback(
    (name: string, query: string): SavedSearch | undefined => {
      if (!projectId) return;

      const newSearch: SavedSearch = {
        id: crypto.randomUUID(),
        name,
        query,
        projectId,
        createdAt: new Date().toISOString(),
      };

      try {
        const stored = localStorage.getItem(SAVED_SEARCHES_KEY);
        const all: SavedSearch[] = stored ? JSON.parse(stored) : [];

        // Check for duplicate name in same project
        const existingIndex = all.findIndex(
          (s) => s.projectId === projectId && s.name === name
        );

        const existing = all[existingIndex];
        if (existingIndex !== -1 && existing) {
          // Update existing
          existing.query = query;
        } else {
          all.push(newSearch);
        }

        localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(all));
        setSavedSearches(all.filter((s) => s.projectId === projectId));

        return newSearch;
      } catch {
        return undefined;
      }
    },
    [projectId]
  );

  const deleteSearch = useCallback(
    (id: string) => {
      try {
        const stored = localStorage.getItem(SAVED_SEARCHES_KEY);
        if (!stored) return;

        const all: SavedSearch[] = JSON.parse(stored);
        const updated = all.filter((s) => s.id !== id);

        localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(updated));
        setSavedSearches(updated.filter((s) => s.projectId === projectId));
      } catch {
        // Ignore errors
      }
    },
    [projectId]
  );

  const setDefault = useCallback(
    (id: string | null) => {
      try {
        const stored = localStorage.getItem(SAVED_SEARCHES_KEY);
        if (!stored) return;

        const all: SavedSearch[] = JSON.parse(stored);

        // Clear existing defaults for this project
        all.forEach((s) => {
          if (s.projectId === projectId) {
            s.isDefault = s.id === id;
          }
        });

        localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(all));
        setSavedSearches(all.filter((s) => s.projectId === projectId));
      } catch {
        // Ignore errors
      }
    },
    [projectId]
  );

  const defaultSearch = savedSearches.find((s) => s.isDefault);

  return {
    savedSearches,
    saveSearch,
    deleteSearch,
    setDefault,
    defaultSearch,
  };
}
