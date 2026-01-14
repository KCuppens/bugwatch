// Query parser
// Converts tokens into a structured ParsedQuery for API consumption

import type { ParsedQuery, SearchFilters, SortConfig, ParseError, SearchToken } from "./types";
import { tokenize } from "./tokenizer";
import { SEARCH_FIELDS } from "./constants";

/**
 * Parses a search query string into a structured ParsedQuery object
 */
export function parseQuery(query: string): ParsedQuery {
  const tokens = tokenize(query);
  const errors: ParseError[] = [];
  const filters: SearchFilters = {};
  let sort: SortConfig | undefined;
  const freeTextParts: string[] = [];

  for (const token of tokens) {
    if (token.type === "text") {
      // Free text search
      freeTextParts.push(token.value);
    } else if (token.type === "operator") {
      // OR operator - we'll handle this in a more advanced version
      // For now, we treat everything as AND
    } else if (token.type === "sort") {
      // Sort directive
      const sortResult = parseSortToken(token);
      if (sortResult.error) {
        errors.push(sortResult.error);
      } else if (sortResult.sort) {
        sort = sortResult.sort;
      }
    } else if (token.type === "field") {
      // Field filter
      const filterResult = parseFieldToken(token, filters);
      if (filterResult.error) {
        errors.push(filterResult.error);
      }
    }
  }

  // Combine free text parts
  const freeText = freeTextParts.join(" ").trim();
  if (freeText) {
    filters.text = freeText;
  }

  return {
    tokens,
    freeText,
    filters,
    sort,
    errors,
  };
}

/**
 * Parses a sort token into a SortConfig
 */
function parseSortToken(token: SearchToken): { sort?: SortConfig; error?: ParseError } {
  const value = token.value.toLowerCase();

  // Check for direction suffix: sort:count:desc or sort:count:asc
  const parts = value.split(":");
  const field = parts[0] ?? "";
  const direction = parts[1] === "asc" ? "asc" : "desc";

  const validSortFields = ["count", "users", "last_seen", "first_seen"];
  if (!validSortFields.includes(field)) {
    return {
      error: {
        message: `Invalid sort field: ${field}. Valid options: ${validSortFields.join(", ")}`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  return {
    sort: { field, direction },
  };
}

/**
 * Parses a field filter token and updates the filters object
 */
function parseFieldToken(
  token: SearchToken,
  filters: SearchFilters
): { error?: ParseError } {
  const field = token.field!;
  const value = token.value;
  const operator = token.operator || "eq";
  const negated = token.negated || false;

  const fieldConfig = SEARCH_FIELDS[field];
  if (!fieldConfig) {
    return {
      error: {
        message: `Unknown field: ${field}`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  // Validate based on field type
  switch (fieldConfig.type) {
    case "enum":
      return parseEnumField(field, value, negated, filters, token, fieldConfig.values || []);
    case "number":
      return parseNumberField(field, value, operator, filters, token);
    case "date":
      return parseDateField(field, value, operator, filters, token);
    case "text":
      return parseTextField(field, value, filters);
    default:
      return {};
  }
}

/**
 * Parses enum fields (is, level)
 */
function parseEnumField(
  field: string,
  value: string,
  negated: boolean,
  filters: SearchFilters,
  token: SearchToken,
  validValues: readonly string[]
): { error?: ParseError } {
  const normalizedValue = value.toLowerCase();

  if (!validValues.includes(normalizedValue)) {
    return {
      error: {
        message: `Invalid value for ${field}: ${value}. Valid options: ${validValues.join(", ")}`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  // Handle 'is' field -> maps to status
  if (field === "is") {
    if (!filters.status) filters.status = [];
    if (!negated) {
      filters.status.push(normalizedValue);
    }
    // Note: negated enum filters would need more complex handling
  } else if (field === "level") {
    if (!filters.level) filters.level = [];
    if (!negated) {
      filters.level.push(normalizedValue);
    }
  }

  return {};
}

/**
 * Parses number fields (count, users)
 */
function parseNumberField(
  field: string,
  value: string,
  operator: string,
  filters: SearchFilters,
  token: SearchToken
): { error?: ParseError } {
  const num = parseInt(value, 10);

  if (isNaN(num)) {
    return {
      error: {
        message: `Invalid number for ${field}: ${value}`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  // Validate that count/users are non-negative
  if (num < 0) {
    return {
      error: {
        message: `${field} must be a non-negative number`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  if (field === "count") {
    switch (operator) {
      case "gt":
        filters.count_gt = num;
        break;
      case "lt":
        filters.count_lt = num;
        break;
      case "gte":
        filters.count_gte = num;
        break;
      case "lte":
        filters.count_lte = num;
        break;
      case "eq":
        filters.count_gte = num;
        filters.count_lte = num;
        break;
    }
  } else if (field === "users") {
    switch (operator) {
      case "gt":
        filters.users_gt = num;
        break;
      case "lt":
        filters.users_lt = num;
        break;
      case "eq":
        filters.users_gt = num - 1;
        filters.users_lt = num + 1;
        break;
    }
  }

  return {};
}

/**
 * Parses date fields (first_seen, last_seen)
 */
function parseDateField(
  field: string,
  value: string,
  operator: string,
  filters: SearchFilters,
  token: SearchToken
): { error?: ParseError } {
  const dateValue = parseRelativeDate(value);

  if (!dateValue) {
    return {
      error: {
        message: `Invalid date for ${field}: ${value}. Use ISO date (2024-01-01) or relative (7d, 24h)`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      },
    };
  }

  const isoDate = dateValue.toISOString();

  if (field === "first_seen") {
    if (operator === "gt") {
      filters.first_seen_after = isoDate;
    } else if (operator === "lt") {
      filters.first_seen_before = isoDate;
    } else {
      // eq means on that day
      filters.first_seen_after = isoDate;
      const nextDay = new Date(dateValue);
      nextDay.setDate(nextDay.getDate() + 1);
      filters.first_seen_before = nextDay.toISOString();
    }
  } else if (field === "last_seen") {
    if (operator === "gt") {
      filters.last_seen_after = isoDate;
    } else if (operator === "lt") {
      filters.last_seen_before = isoDate;
    } else {
      filters.last_seen_after = isoDate;
      const nextDay = new Date(dateValue);
      nextDay.setDate(nextDay.getDate() + 1);
      filters.last_seen_before = nextDay.toISOString();
    }
  }

  return {};
}

/**
 * Parses text fields (title, fingerprint)
 */
function parseTextField(
  _field: string,
  value: string,
  filters: SearchFilters
): { error?: ParseError } {
  // Text fields just add to the text search for now
  // In a more advanced version, we could have field-specific text search
  if (filters.text) {
    filters.text += " " + value;
  } else {
    filters.text = value;
  }

  return {};
}

/**
 * Parses relative date strings like "7d", "24h", "2w", "today"
 */
function parseRelativeDate(value: string): Date | null {
  const now = new Date();

  // Handle special keywords
  const lower = value.toLowerCase();
  if (lower === "today") {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return today;
  }
  if (lower === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  }
  if (lower === "this_week") {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return startOfWeek;
  }
  if (lower === "this_month") {
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return startOfMonth;
  }

  // Handle relative time like "7d", "24h", "2w"
  const relativeMatch = value.match(/^(\d+)([hdwm])$/i);
  if (relativeMatch) {
    const numStr = relativeMatch[1] ?? "0";
    const unit = relativeMatch[2] ?? "d";
    const num = parseInt(numStr, 10);
    const result = new Date(now);

    switch (unit.toLowerCase()) {
      case "h":
        result.setHours(result.getHours() - num);
        break;
      case "d":
        result.setDate(result.getDate() - num);
        break;
      case "w":
        result.setDate(result.getDate() - num * 7);
        break;
      case "m":
        result.setMonth(result.getMonth() - num);
        break;
    }

    return result;
  }

  // Try parsing as ISO date
  const isoDate = new Date(value);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  return null;
}

/**
 * Converts a ParsedQuery back into a query string
 * Useful for programmatically building queries
 */
export function stringifyQuery(parsed: ParsedQuery): string {
  const parts: string[] = [];

  // Add status filters
  if (parsed.filters.status) {
    for (const status of parsed.filters.status) {
      parts.push(`is:${status}`);
    }
  }

  // Add level filters
  if (parsed.filters.level) {
    for (const level of parsed.filters.level) {
      parts.push(`level:${level}`);
    }
  }

  // Add count filters
  if (parsed.filters.count_gt !== undefined) {
    parts.push(`count:>${parsed.filters.count_gt}`);
  }
  if (parsed.filters.count_lt !== undefined) {
    parts.push(`count:<${parsed.filters.count_lt}`);
  }

  // Add users filters
  if (parsed.filters.users_gt !== undefined) {
    parts.push(`users:>${parsed.filters.users_gt}`);
  }

  // Add sort
  if (parsed.sort) {
    parts.push(`sort:${parsed.sort.field}${parsed.sort.direction === "asc" ? ":asc" : ""}`);
  }

  // Add free text
  if (parsed.freeText) {
    // Quote if contains spaces
    if (parsed.freeText.includes(" ")) {
      parts.push(`"${parsed.freeText}"`);
    } else {
      parts.push(parsed.freeText);
    }
  }

  return parts.join(" ");
}
