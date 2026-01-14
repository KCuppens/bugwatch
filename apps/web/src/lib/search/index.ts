// Search library barrel export

// Types
export type {
  SearchToken,
  ParsedQuery,
  SearchFilters,
  SortConfig,
  ParseError,
  FilterOperator,
  LogicalOperator,
  Suggestion,
  SuggestionType,
  SuggestionContext,
  SavedSearch,
  Facets,
  SearchRequest,
  SearchResponse,
} from "./types";

// Constants
export {
  SEARCH_FIELDS,
  SORT_FIELDS,
  RELATIVE_TIME_UNITS,
  DATE_SHORTCUTS,
  LEVEL_COLORS,
  STATUS_COLORS,
  FIELD_ICONS,
  FIELD_ALIASES,
  ALL_FIELD_NAMES,
} from "./constants";
export type { FieldConfig, SortField } from "./constants";

// Tokenizer
export {
  tokenize,
  getTokenAtPosition,
  getWordAtCursor,
  isAfterFieldColon,
} from "./tokenizer";

// Parser
export { parseQuery, stringifyQuery } from "./parser";

// Suggestions
export { getSuggestions, fuzzyScore, highlightMatch } from "./suggestions";
