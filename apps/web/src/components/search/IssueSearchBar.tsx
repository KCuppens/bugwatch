"use client";

import { useRef, useEffect, useCallback } from "react";
import { Search, X, Command, Loader2, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearch } from "@/hooks/useSearch";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { LEVEL_COLORS, STATUS_COLORS } from "@/lib/search";
import type { Issue, Facets } from "@/lib/api";

interface IssueSearchBarProps {
  projectId: string | undefined;
  onResultsChange?: (results: Issue[]) => void;
  onFacetsChange?: (facets: Facets | null) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  className?: string;
  sortBy?: string;
  onSortChange?: (sort: string) => void;
}

export function IssueSearchBar({
  projectId,
  onResultsChange,
  onFacetsChange,
  onLoadingChange,
  className,
  sortBy = "recent",
  onSortChange,
}: IssueSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    query,
    setQuery,
    parsedQuery,
    results,
    facets,
    isLoading,
    suggestions,
    isAutocompleteOpen,
    setAutocompleteOpen,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    executeSearch,
    clearSearch,
    selectSuggestion,
    triggerSearch,
  } = useSearch({ projectId });

  // Keyboard navigation for autocomplete
  useKeyboardNavigation({
    itemCount: suggestions.length,
    selectedIndex: selectedSuggestionIndex,
    setSelectedIndex: setSelectedSuggestionIndex,
    onSelect: () => {
      const suggestion = suggestions[selectedSuggestionIndex];
      if (suggestion) {
        selectSuggestion(suggestion);
      }
    },
    onEscape: () => setAutocompleteOpen(false),
    isEnabled: isAutocompleteOpen && suggestions.length > 0,
  });

  // Notify parent of changes
  useEffect(() => {
    onResultsChange?.(results);
  }, [results, onResultsChange]);

  useEffect(() => {
    onFacetsChange?.(facets);
  }, [facets, onFacetsChange]);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Global keyboard shortcut for focusing search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setAutocompleteOpen(true);
      }
      // "/" to focus search (vim-style)
      if (e.key === "/" && !isInputFocused()) {
        e.preventDefault();
        inputRef.current?.focus();
        setAutocompleteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setAutocompleteOpen]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setAutocompleteOpen(true);
    },
    [setQuery, setAutocompleteOpen]
  );

  const handleInputFocus = useCallback(() => {
    setAutocompleteOpen(true);
  }, [setAutocompleteOpen]);

  const handleInputBlur = useCallback(() => {
    // Delay closing to allow click on suggestions
    setTimeout(() => {
      setAutocompleteOpen(false);
    }, 200);
  }, [setAutocompleteOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isAutocompleteOpen) {
        executeSearch();
      }
    },
    [executeSearch, isAutocompleteOpen]
  );

  // Extract active filters from parsed query for display
  const activeFilters = parsedQuery?.tokens.filter(
    (t) => t.type === "field" && t.field && t.value
  ) || [];

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card/50 backdrop-blur transition-all hover:border-primary/30 hover:bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
        {isLoading ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" />
        )}

        {/* Token chips for active filters */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-1.5">
            {activeFilters.map((token, index) => {
              const colorClass = getFilterColorClass(token.field!, token.value);
              return (
                <span
                  key={index}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium animate-token-pop",
                    colorClass
                  )}
                >
                  {token.field}:{token.value}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Remove this filter from query
                      const newQuery = query.replace(token.raw, "").trim();
                      setQuery(newQuery);
                    }}
                    className="hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          placeholder="Search issues... (⌘K)"
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-[100px]"
        />

        {/* Clear button */}
        {query && (
          <button
            type="button"
            onClick={clearSearch}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}

        {/* Quick filters */}
        <div className="flex items-center gap-1 border-l pl-3">
          <button
            type="button"
            onClick={() => {
              const newQuery = query + (query ? " " : "") + "level:error";
              triggerSearch(newQuery);
            }}
            className="px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
          >
            Errors
          </button>
          <button
            type="button"
            onClick={() => {
              const newQuery = query + (query ? " " : "") + "is:unresolved";
              triggerSearch(newQuery);
            }}
            className="px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
          >
            Unresolved
          </button>
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2 border-l pl-3">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange?.(e.target.value)}
            className="bg-transparent text-xs outline-none cursor-pointer"
          >
            <option value="recent">Recent</option>
            <option value="frequent">Frequent</option>
            <option value="users">Users</option>
            <option value="trending">Trending</option>
          </select>
        </div>

        {/* Keyboard shortcut hint */}
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          <Command className="h-3 w-3" />K
        </kbd>
      </div>

      {/* Autocomplete dropdown */}
      {isAutocompleteOpen && suggestions.length > 0 && (
        <SearchAutocomplete
          suggestions={suggestions}
          selectedIndex={selectedSuggestionIndex}
          onSelect={selectSuggestion}
          onHover={setSelectedSuggestionIndex}
          query={query}
        />
      )}
    </div>
  );
}

/**
 * Returns color classes for filter chips based on type and value
 */
function getFilterColorClass(field: string, value: string): string {
  if (field === "level") {
    const colors = LEVEL_COLORS[value];
    if (colors) {
      return `${colors.bg} ${colors.text}`;
    }
  }
  if (field === "is") {
    const colors = STATUS_COLORS[value];
    if (colors) {
      return `${colors.bg} ${colors.text}`;
    }
  }
  return "bg-primary/10 text-primary";
}

/**
 * Checks if an input element is currently focused
 */
function isInputFocused(): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  );
}
