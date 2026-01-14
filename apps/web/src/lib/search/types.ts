// Search system type definitions

export type FilterOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains";
export type LogicalOperator = "AND" | "OR";

export interface SearchToken {
  type: "field" | "text" | "operator" | "sort";
  field?: string;
  operator?: FilterOperator;
  value: string;
  negated?: boolean;
  raw: string; // Original text for display
  startIndex: number; // Position in query string
  endIndex: number;
}

export interface ParsedQuery {
  tokens: SearchToken[];
  freeText: string;
  filters: SearchFilters;
  sort?: SortConfig;
  errors: ParseError[];
}

export interface SearchFilters {
  status?: string[];
  level?: string[];
  count_gt?: number;
  count_lt?: number;
  count_gte?: number;
  count_lte?: number;
  users_gt?: number;
  users_lt?: number;
  first_seen_after?: string;
  first_seen_before?: string;
  last_seen_after?: string;
  last_seen_before?: string;
  text?: string;
}

export interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

export interface ParseError {
  message: string;
  startIndex: number;
  endIndex: number;
}

// Suggestion types
export type SuggestionType = "field" | "value" | "history" | "saved" | "operator";

export interface Suggestion {
  type: SuggestionType;
  label: string;
  value: string;
  description?: string;
  icon?: string;
  category?: string;
  count?: number; // For facet counts
  score: number; // For ranking
}

export interface SuggestionContext {
  query: string;
  cursorPosition: number;
  currentToken: SearchToken | null;
  existingFilters: string[];
}

// Saved search types
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  projectId: string;
  createdAt: string;
  isDefault?: boolean;
}

// Facet counts from backend
export interface Facets {
  level: Record<string, number>;
  status: Record<string, number>;
}

// API types
export interface SearchRequest {
  query?: string;
  filters?: SearchFilters;
  sort?: SortConfig;
  page?: number;
  per_page?: number;
}

export interface SearchResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
  facets: Facets;
  query_time_ms?: number;
}
