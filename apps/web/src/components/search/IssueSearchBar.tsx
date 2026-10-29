"use client";

import { useRef, useEffect, useCallback } from "react";
import { Search, X, Loader2, Clock, Zap, Users, TrendingUp, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearch } from "@/hooks/useSearch";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { LEVEL_COLORS, STATUS_COLORS } from "@/lib/search";
import type { Issue, Facets } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SearchToken } from "@/lib/search/types";

interface FieldToken extends SearchToken {
  type: "field";
  field: string;
}

interface IssueSearchBarProps {
  projectId: string | undefined;
  onResultsChange?: (results: Issue[]) => void;
  onFacetsChange?: (facets: Facets | null) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onQueryChange?: (query: string) => void;
  className?: string;
  sortBy?: string;
  onSortChange?: (sort: string) => void;
}

export function IssueSearchBar({
  projectId,
  onResultsChange,
  onFacetsChange,
  onLoadingChange,
  onQueryChange,
  className,
  sortBy = "recent",
  onSortChange,
}: IssueSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    []
  );

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

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  // Global keyboard shortcut for focusing search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    blurTimerRef.current = setTimeout(() => {
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
  const activeFilters = (parsedQuery?.tokens.filter(
    (t): t is FieldToken => t.type === "field" && !!t.field && !!t.value
  ) ?? []);

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle bg-surface-2 transition-all hover:border-accent-2/40 focus-within:border-accent-2/60 focus-within:ring-2 focus-within:ring-accent-2/20">
        {isLoading ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" />
        )}

        {/* Token chips for active filters */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-1.5">
            {activeFilters.map((token, index) => {
              const colorClass = getFilterColorClass(token.field, token.value);
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
                    aria-label={`Remove ${token.field} filter`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Remove this filter from query
                      const newQuery = query.split(token.raw).join("").trim();
                      setQuery(newQuery);
                    }}
                    className="hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search issues"
          aria-expanded={isAutocompleteOpen && suggestions.length > 0}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls="search-autocomplete-listbox"
          placeholder="Search issues... (/)"
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
            aria-label="Clear search"
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        )}

        {/* Quick filters */}
        <div className="flex items-center gap-1 border-l pl-3">
          <button
            type="button"
            aria-pressed={query.includes("level:error")}
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
            aria-pressed={query.includes("is:unresolved")}
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
        <div className="border-l pl-3">
          <SortDropdown sortBy={sortBy ?? "recent"} onSortChange={onSortChange} />
        </div>

        {/* Keyboard shortcut hint — decorative, screen readers get hint from placeholder */}
        <kbd aria-hidden="true" className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          /
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

const SORT_OPTIONS = [
  {
    value: "recent",
    label: "Recent",
    description: "Most recently seen",
    icon: Clock,
  },
  {
    value: "frequent",
    label: "Frequent",
    description: "Most event occurrences",
    icon: Zap,
  },
  {
    value: "users",
    label: "Users",
    description: "Most users affected",
    icon: Users,
  },
  {
    value: "trending",
    label: "Trending",
    description: "Fastest growing rate",
    icon: TrendingUp,
  },
] as const;

function SortDropdown({
  sortBy,
  onSortChange,
}: {
  sortBy: string;
  onSortChange?: (sort: string) => void;
}) {
  const active = SORT_OPTIONS.find((o) => o.value === sortBy) ?? SORT_OPTIONS[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort by: ${active.label}`}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/40"
        >
          <ActiveIcon className="h-3 w-3" aria-hidden="true" />
          <span>{active.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5">
          Sort issues by
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SORT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = sortBy === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onSortChange?.(option.value)}
              className={cn("gap-3 pr-2", isActive && "text-accent-2 bg-accent-2/8 hover:bg-accent-2/12 focus:bg-accent-2/12 hover:text-accent-2 focus:text-accent-2")}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{option.label}</div>
                <div className="text-[11px] text-muted-foreground">{option.description}</div>
              </div>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-accent-2" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  return "bg-accent-2/10 text-accent-2";
}

/**
 * Checks if an input element is currently focused
 */
function isInputFocused(): boolean {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
}
