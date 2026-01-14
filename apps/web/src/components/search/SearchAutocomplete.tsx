"use client";

import { useRef, useEffect } from "react";
import {
  Search,
  Clock,
  Bookmark,
  Hash,
  AlertTriangle,
  Users,
  Calendar,
  Type,
  Fingerprint,
  ArrowUpDown,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/lib/search";
import { highlightMatch } from "@/lib/search";

interface SearchAutocompleteProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  onSelect: (suggestion: Suggestion) => void;
  onHover: (index: number) => void;
  query: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  bookmark: Bookmark,
  hash: Hash,
  "alert-triangle": AlertTriangle,
  users: Users,
  calendar: Calendar,
  type: Type,
  fingerprint: Fingerprint,
  "arrow-up-down": ArrowUpDown,
  "circle-dot": Search,
  "alert-circle": AlertTriangle,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
};

export function SearchAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
  query,
}: SearchAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  if (suggestions.length === 0) {
    return null;
  }

  // Group suggestions by category
  const groupedSuggestions = suggestions.reduce((acc, suggestion) => {
    const category = suggestion.category || "Suggestions";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(suggestion);
    return acc;
  }, {} as Record<string, Suggestion[]>);

  let globalIndex = 0;

  return (
    <div
      ref={listRef}
      className="absolute top-full left-0 right-0 mt-2 max-h-80 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50 animate-in fade-in slide-in-from-top-2"
    >
      {Object.entries(groupedSuggestions).map(([category, items]) => (
        <div key={category}>
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground sticky top-0 bg-popover border-b">
            {category}
          </div>
          {items.map((suggestion) => {
            const currentIndex = globalIndex++;
            const isSelected = currentIndex === selectedIndex;
            const Icon = suggestion.icon
              ? iconMap[suggestion.icon] || Search
              : Search;

            return (
              <div
                key={`${suggestion.type}-${suggestion.value}-${currentIndex}`}
                ref={isSelected ? selectedRef : null}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                  isSelected ? "bg-accent" : "hover:bg-muted"
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent input blur
                  onSelect(suggestion);
                }}
                onMouseEnter={() => onHover(currentIndex)}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    suggestion.type === "history"
                      ? "text-muted-foreground"
                      : suggestion.type === "saved"
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate">
                      {renderHighlightedLabel(suggestion.label, query)}
                    </span>
                    {suggestion.count !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        ({suggestion.count})
                      </span>
                    )}
                  </div>
                  {suggestion.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {suggestion.description}
                    </p>
                  )}
                </div>
                {isSelected && (
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Footer with keyboard hints */}
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground bg-muted/50">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1">↑↓</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1">Tab</kbd>
            Select
          </span>
        </div>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-background px-1">Esc</kbd>
          Close
        </span>
      </div>
    </div>
  );
}

function renderHighlightedLabel(label: string, query: string) {
  const parts = highlightMatch(label, query);
  return (
    <>
      {parts.map((part, i) =>
        part.highlighted ? (
          <span key={i} className="font-semibold text-primary">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
