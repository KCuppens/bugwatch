// Autocomplete suggestions logic

import type { Suggestion, SuggestionContext, Facets, SavedSearch } from "./types";
import { SEARCH_FIELDS, DATE_SHORTCUTS, FIELD_ICONS, SORT_FIELDS } from "./constants";
import { getWordAtCursor, isAfterFieldColon } from "./tokenizer";

/**
 * Generates autocomplete suggestions based on the current query and cursor position
 */
export function getSuggestions(
  context: SuggestionContext,
  history: string[],
  savedSearches: SavedSearch[],
  facets?: Facets
): Suggestion[] {
  const { query, cursorPosition, existingFilters } = context;
  const suggestions: Suggestion[] = [];

  // Case 1: Empty query - show history and saved searches first
  if (!query.trim()) {
    return getEmptyQuerySuggestions(history, savedSearches);
  }

  // Check what we're currently typing
  const fieldContext = isAfterFieldColon(query, cursorPosition);
  const currentWord = getWordAtCursor(query, cursorPosition);

  // Case 2: After a field colon (e.g., "level:|" or "level:err|")
  if (fieldContext) {
    return getValueSuggestions(fieldContext.field, fieldContext.valueStart, facets);
  }

  // Case 3: Typing a potential field name (e.g., "lev|")
  if (currentWord && !currentWord.includes(":")) {
    const fieldSuggestions = getFieldSuggestions(currentWord, existingFilters);
    if (fieldSuggestions.length > 0) {
      suggestions.push(...fieldSuggestions);
    }
  }

  // Case 4: Show quick actions if nothing specific matches
  if (suggestions.length === 0) {
    suggestions.push(...getQuickFilterSuggestions(existingFilters));
  }

  // Always show matching history at the bottom
  const matchingHistory = getMatchingHistory(query, history);
  suggestions.push(...matchingHistory);

  return suggestions.slice(0, 10); // Limit total suggestions
}

/**
 * Suggestions for empty query - show history and saved searches
 */
function getEmptyQuerySuggestions(
  history: string[],
  savedSearches: SavedSearch[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Saved searches first
  savedSearches.slice(0, 3).forEach((saved, i) => {
    suggestions.push({
      type: "saved",
      label: saved.name,
      value: saved.query,
      description: saved.query,
      icon: "bookmark",
      category: "Saved Searches",
      score: 100 - i,
    });
  });

  // Then recent history
  history.slice(0, 5).forEach((h, i) => {
    suggestions.push({
      type: "history",
      label: h,
      value: h,
      icon: "clock",
      category: "Recent",
      score: 90 - i,
    });
  });

  // Quick start suggestions
  suggestions.push(
    {
      type: "field",
      label: "is:",
      value: "is:",
      description: "Filter by status",
      icon: "circle-dot",
      category: "Fields",
      score: 80,
    },
    {
      type: "field",
      label: "level:",
      value: "level:",
      description: "Filter by severity",
      icon: "alert-triangle",
      category: "Fields",
      score: 79,
    }
  );

  return suggestions;
}

/**
 * Suggestions for field values after typing "field:"
 */
function getValueSuggestions(
  field: string,
  valueStart: string,
  facets?: Facets
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const fieldConfig = SEARCH_FIELDS[field];

  if (!fieldConfig) return suggestions;

  if (fieldConfig.type === "enum" && fieldConfig.values) {
    // Filter values that match what's been typed
    const matchingValues = fieldConfig.values.filter((v) =>
      v.toLowerCase().startsWith(valueStart.toLowerCase())
    );

    matchingValues.forEach((value, i) => {
      // Get count from facets if available
      let count: number | undefined;
      if (facets) {
        if (field === "is" && facets.status) {
          count = facets.status[value];
        } else if (field === "level" && facets.level) {
          count = facets.level[value];
        }
      }

      suggestions.push({
        type: "value",
        label: value,
        value: `${field}:${value}`,
        description: count !== undefined ? `${count} issues` : undefined,
        count,
        icon: FIELD_ICONS[field],
        category: fieldConfig.description,
        score: 100 - i + fuzzyScore(value, valueStart),
      });
    });
  } else if (fieldConfig.type === "date") {
    // Show date shortcuts
    DATE_SHORTCUTS.filter((d) =>
      d.label.toLowerCase().startsWith(valueStart.toLowerCase())
    ).forEach((shortcut, i) => {
      suggestions.push({
        type: "value",
        label: shortcut.label,
        value: `${field}:>${shortcut.label}`,
        description: shortcut.description,
        icon: "calendar",
        category: "Date shortcuts",
        score: 90 - i,
      });
    });

    // Also suggest comparison operators
    if (!valueStart) {
      suggestions.push(
        {
          type: "value",
          label: ">",
          value: `${field}:>`,
          description: "After date",
          icon: "chevron-right",
          category: "Operators",
          score: 85,
        },
        {
          type: "value",
          label: "<",
          value: `${field}:<`,
          description: "Before date",
          icon: "chevron-left",
          category: "Operators",
          score: 84,
        }
      );
    }
  } else if (fieldConfig.type === "number") {
    // Suggest comparison operators for number fields
    if (!valueStart) {
      suggestions.push(
        {
          type: "value",
          label: ">",
          value: `${field}:>`,
          description: "Greater than",
          icon: "chevron-right",
          category: "Operators",
          score: 90,
        },
        {
          type: "value",
          label: "<",
          value: `${field}:<`,
          description: "Less than",
          icon: "chevron-left",
          category: "Operators",
          score: 89,
        },
        {
          type: "value",
          label: ">=",
          value: `${field}:>=`,
          description: "Greater than or equal",
          icon: "chevron-right",
          category: "Operators",
          score: 88,
        },
        {
          type: "value",
          label: "<=",
          value: `${field}:<=`,
          description: "Less than or equal",
          icon: "chevron-left",
          category: "Operators",
          score: 87,
        }
      );
    }
  }

  // Special handling for sort field
  if (field === "sort") {
    SORT_FIELDS.filter((f) =>
      f.toLowerCase().startsWith(valueStart.toLowerCase())
    ).forEach((sortField, i) => {
      suggestions.push({
        type: "value",
        label: sortField,
        value: `sort:${sortField}`,
        description: `Sort by ${sortField.replace("_", " ")}`,
        icon: "arrow-up-down",
        category: "Sort options",
        score: 90 - i,
      });
    });
  }

  return suggestions;
}

/**
 * Suggestions for field names when typing
 */
function getFieldSuggestions(
  partial: string,
  existingFilters: string[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const partialLower = partial.toLowerCase();

  // Main fields
  Object.entries(SEARCH_FIELDS).forEach(([field, config]) => {
    if (
      field.toLowerCase().startsWith(partialLower) &&
      !existingFilters.includes(field)
    ) {
      suggestions.push({
        type: "field",
        label: `${field}:`,
        value: `${field}:`,
        description: config.description,
        icon: FIELD_ICONS[field],
        category: "Fields",
        score: fuzzyScore(field, partial),
      });
    }
  });

  // Sort field
  if ("sort".startsWith(partialLower)) {
    suggestions.push({
      type: "field",
      label: "sort:",
      value: "sort:",
      description: "Sort results",
      icon: "arrow-up-down",
      category: "Fields",
      score: fuzzyScore("sort", partial),
    });
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

/**
 * Quick filter suggestions (common filters)
 */
function getQuickFilterSuggestions(existingFilters: string[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (!existingFilters.includes("is")) {
    suggestions.push({
      type: "field",
      label: "Unresolved issues",
      value: "is:unresolved",
      description: "Show unresolved issues only",
      icon: "circle-dot",
      category: "Quick Filters",
      score: 70,
    });
  }

  if (!existingFilters.includes("level")) {
    suggestions.push({
      type: "field",
      label: "Errors only",
      value: "level:error",
      description: "Show error-level issues",
      icon: "alert-circle",
      category: "Quick Filters",
      score: 69,
    });
  }

  suggestions.push({
    type: "field",
    label: "Recent (24h)",
    value: "last_seen:>1d",
    description: "Issues seen in the last 24 hours",
    icon: "clock",
    category: "Quick Filters",
    score: 68,
  });

  return suggestions;
}

/**
 * Get history items matching current query
 */
function getMatchingHistory(query: string, history: string[]): Suggestion[] {
  if (!query) return [];

  const queryLower = query.toLowerCase();
  return history
    .filter((h) => h.toLowerCase().includes(queryLower) && h !== query)
    .slice(0, 3)
    .map((h, i) => ({
      type: "history" as const,
      label: h,
      value: h,
      icon: "clock",
      category: "History",
      score: 50 - i,
    }));
}

/**
 * Simple fuzzy scoring - higher score = better match
 */
export function fuzzyScore(target: string, query: string): number {
  if (!query) return 50;

  const targetLower = target.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match
  if (targetLower === queryLower) return 100;

  // Starts with
  if (targetLower.startsWith(queryLower)) {
    return 90 + (queryLower.length / targetLower.length) * 10;
  }

  // Contains
  if (targetLower.includes(queryLower)) {
    return 70 + (queryLower.length / targetLower.length) * 10;
  }

  // Character-by-character fuzzy match
  let score = 0;
  let queryIndex = 0;

  for (let i = 0; i < targetLower.length && queryIndex < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIndex]) {
      score += 10;
      queryIndex++;
    }
  }

  return queryIndex === queryLower.length ? score : 0;
}

/**
 * Highlight matching parts of a suggestion label
 * Returns an array of { text: string, highlighted: boolean }
 */
export function highlightMatch(
  label: string,
  query: string
): Array<{ text: string; highlighted: boolean }> {
  // Validate inputs
  if (!label || typeof label !== "string") {
    return [{ text: String(label || ""), highlighted: false }];
  }
  if (!query || typeof query !== "string") {
    return [{ text: label, highlighted: false }];
  }

  const result: Array<{ text: string; highlighted: boolean }> = [];
  const labelLower = label.toLowerCase();
  const queryLower = query.toLowerCase();

  let lastIndex = 0;
  let index = labelLower.indexOf(queryLower);

  while (index !== -1) {
    // Add non-highlighted part before match
    if (index > lastIndex) {
      result.push({
        text: label.slice(lastIndex, index),
        highlighted: false,
      });
    }

    // Add highlighted match
    result.push({
      text: label.slice(index, index + query.length),
      highlighted: true,
    });

    lastIndex = index + query.length;
    index = labelLower.indexOf(queryLower, lastIndex);
  }

  // Add remaining non-highlighted part
  if (lastIndex < label.length) {
    result.push({
      text: label.slice(lastIndex),
      highlighted: false,
    });
  }

  return result.length > 0 ? result : [{ text: label, highlighted: false }];
}
