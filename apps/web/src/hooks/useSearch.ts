"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useDebounce } from "./useDebounce";
import { useSearchHistory } from "./useSearchHistory";
import { parseQuery, getSuggestions, type ParsedQuery, type Suggestion, type Facets } from "@/lib/search";
import { issuesApi, type Issue, type SearchFilters } from "@/lib/api";

interface UseSearchOptions {
  projectId: string | undefined;
  initialQuery?: string;
  debounceMs?: number;
}

interface UseSearchReturn {
  // Query state
  query: string;
  setQuery: (query: string) => void;
  parsedQuery: ParsedQuery | null;

  // Results
  results: Issue[];
  facets: Facets | null;
  isLoading: boolean;
  error: string | null;

  // Autocomplete
  suggestions: Suggestion[];
  isAutocompleteOpen: boolean;
  setAutocompleteOpen: (open: boolean) => void;
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: (index: number) => void;

  // Actions
  executeSearch: () => void;
  clearSearch: () => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  triggerSearch: (query: string) => void;

  // History
  history: string[];
  addToHistory: (query: string) => void;
}

export function useSearch({
  projectId,
  initialQuery = "",
  debounceMs = 150,
}: UseSearchOptions): UseSearchReturn {
  // Query state
  const [query, setQuery] = useState(initialQuery);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);

  // Results state
  const [results, setResults] = useState<Issue[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete state
  const [isAutocompleteOpen, setAutocompleteOpen] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

  // Hooks
  const { history, addToHistory } = useSearchHistory();
  const debouncedQuery = useDebounce(query, debounceMs);

  // Parse query on change
  useEffect(() => {
    const parsed = parseQuery(query);
    setParsedQuery(parsed);
  }, [query]);

  // Generate suggestions
  const suggestions = useMemo(() => {
    if (!isAutocompleteOpen) return [];

    const existingFilters = parsedQuery?.tokens
      .filter((t) => t.type === "field" && t.field)
      .map((t) => t.field!) || [];

    return getSuggestions(
      {
        query,
        cursorPosition: query.length,
        currentToken: parsedQuery?.tokens[parsedQuery.tokens.length - 1] || null,
        existingFilters,
      },
      history,
      [], // savedSearches - will be passed from component
      facets || undefined
    );
  }, [query, parsedQuery, isAutocompleteOpen, history, facets]);

  // Reset suggestion index when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestions]);

  // Convert parsed filters to API format
  const convertFilters = useCallback((parsed: ParsedQuery | null): SearchFilters | undefined => {
    if (!parsed) return undefined;

    const filters: SearchFilters = {};

    if (parsed.filters.status?.length) {
      filters.status = parsed.filters.status;
    }
    if (parsed.filters.level?.length) {
      filters.level = parsed.filters.level;
    }
    if (parsed.filters.count_gt !== undefined) {
      filters.count_gt = parsed.filters.count_gt;
    }
    if (parsed.filters.count_lt !== undefined) {
      filters.count_lt = parsed.filters.count_lt;
    }
    if (parsed.filters.count_gte !== undefined) {
      filters.count_gte = parsed.filters.count_gte;
    }
    if (parsed.filters.count_lte !== undefined) {
      filters.count_lte = parsed.filters.count_lte;
    }
    if (parsed.filters.users_gt !== undefined) {
      filters.users_gt = parsed.filters.users_gt;
    }
    if (parsed.filters.users_lt !== undefined) {
      filters.users_lt = parsed.filters.users_lt;
    }
    if (parsed.filters.first_seen_after) {
      filters.first_seen_after = parsed.filters.first_seen_after;
    }
    if (parsed.filters.first_seen_before) {
      filters.first_seen_before = parsed.filters.first_seen_before;
    }
    if (parsed.filters.last_seen_after) {
      filters.last_seen_after = parsed.filters.last_seen_after;
    }
    if (parsed.filters.last_seen_before) {
      filters.last_seen_before = parsed.filters.last_seen_before;
    }
    if (parsed.filters.text) {
      filters.text = parsed.filters.text;
    }

    return Object.keys(filters).length > 0 ? filters : undefined;
  }, []);

  // Ref to track current query for immediate searches
  const queryRef = useRef(query);
  queryRef.current = query;

  // Search function that can be called directly
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!projectId) {
      setResults([]);
      setFacets(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const parsed = parseQuery(searchQuery);
      const response = await issuesApi.search(projectId, {
        filters: convertFilters(parsed),
        sort: parsed.sort
          ? { field: parsed.sort.field, direction: parsed.sort.direction }
          : undefined,
      });

      setResults(response.data);
      setFacets(response.facets);
    } catch (err) {
      console.error("Search failed:", err);
      setError("Search failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, convertFilters]);

  // Execute search when debounced query changes
  useEffect(() => {
    if (!projectId) {
      setResults([]);
      setFacets(null);
      return;
    }

    // Track if this effect is still mounted
    let isCancelled = false;

    const search = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const parsed = parseQuery(debouncedQuery);
        const response = await issuesApi.search(projectId, {
          filters: convertFilters(parsed),
          sort: parsed.sort
            ? { field: parsed.sort.field, direction: parsed.sort.direction }
            : undefined,
        });

        // Only update state if not cancelled
        if (!isCancelled) {
          setResults(response.data);
          setFacets(response.facets);
        }
      } catch (err) {
        // Only update state if not cancelled and not an abort error
        if (!isCancelled) {
          console.error("Search failed:", err);
          setError("Search failed. Please try again.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    search();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isCancelled = true;
    };
  }, [projectId, debouncedQuery, convertFilters]);

  // Execute search (manual trigger)
  const executeSearch = useCallback(() => {
    if (query.trim()) {
      addToHistory(query.trim());
    }
    setAutocompleteOpen(false);
  }, [query, addToHistory]);

  // Clear search
  const clearSearch = useCallback(() => {
    setQuery("");
    setParsedQuery(null);
    setAutocompleteOpen(false);
  }, []);

  // Select a suggestion
  const selectSuggestion = useCallback((suggestion: Suggestion) => {
    let newQuery: string;

    if (suggestion.type === "history" || suggestion.type === "saved") {
      // Replace entire query
      newQuery = suggestion.value;
    } else {
      // Append to query
      const currentQuery = query.trim();

      // If the suggestion is a field completion (e.g., "level:")
      // and we're already typing that field, replace the partial
      const words = currentQuery.split(/\s+/);
      const lastWord = words[words.length - 1] || "";

      if (suggestion.type === "field" && lastWord && !lastWord.includes(":")) {
        // Replace partial field name with complete one
        words[words.length - 1] = suggestion.value;
        newQuery = words.join(" ");
      } else if (suggestion.type === "value") {
        // Replace the current field:partial with field:value
        if (lastWord.includes(":")) {
          words[words.length - 1] = suggestion.value;
          newQuery = words.join(" ") + " ";
        } else {
          newQuery = currentQuery + (currentQuery ? " " : "") + suggestion.value + " ";
        }
      } else {
        newQuery = currentQuery + (currentQuery ? " " : "") + suggestion.value;
      }
    }

    setQuery(newQuery);
    setAutocompleteOpen(false);

    // Trigger immediate search for value suggestions (complete filters)
    if (suggestion.type === "value" || suggestion.type === "history" || suggestion.type === "saved") {
      // Use setTimeout to ensure state is updated before search
      setTimeout(() => {
        performSearch(newQuery.trim());
      }, 0);
    }
  }, [query, performSearch]);

  // Trigger search with a specific query (for quick filters)
  const triggerSearch = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
    setAutocompleteOpen(false);
    // Use setTimeout to ensure state is updated
    setTimeout(() => {
      performSearch(searchQuery.trim());
    }, 0);
  }, [performSearch]);

  return {
    query,
    setQuery,
    parsedQuery,
    results,
    facets,
    isLoading,
    error,
    suggestions,
    isAutocompleteOpen,
    setAutocompleteOpen,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    executeSearch,
    clearSearch,
    selectSuggestion,
    triggerSearch,
    history,
    addToHistory,
  };
}
