// Query string tokenizer
// Converts a search query string into tokens

import type { SearchToken, FilterOperator } from "./types";
import { ALL_FIELD_NAMES, FIELD_ALIASES } from "./constants";

/**
 * Tokenizes a search query string into structured tokens
 *
 * Supports:
 * - Field filters: is:unresolved, level:error
 * - Comparisons: count:>100, users:>=5
 * - Negation: -is:ignored
 * - Quoted strings: "exact phrase"
 * - Sort directives: sort:count, sort:last_seen:desc
 * - Free text: any text not matching above patterns
 */
export function tokenize(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let position = 0;

  while (position < query.length) {
    // Skip whitespace
    const wsMatch = query.slice(position).match(/^\s+/);
    if (wsMatch) {
      position += wsMatch[0].length;
      continue;
    }

    const remaining = query.slice(position);
    let token: SearchToken | null = null;

    // Pattern 1: Quoted string - "exact phrase"
    const quotedMatch = remaining.match(/^"([^"]*)"?/);
    if (quotedMatch) {
      token = {
        type: "text",
        value: quotedMatch[1] ?? "",
        raw: quotedMatch[0],
        startIndex: position,
        endIndex: position + quotedMatch[0].length,
      };
    }

    // Pattern 2: Negated field filter - -field:value
    if (!token) {
      const negatedFieldMatch = remaining.match(
        /^-(\w+):([<>=!]*)("[^"]*"|[^\s]*)/
      );
      if (negatedFieldMatch) {
        const full = negatedFieldMatch[0];
        const field = negatedFieldMatch[1] ?? "";
        const op = negatedFieldMatch[2] ?? "";
        const value = negatedFieldMatch[3] ?? "";
        const normalizedField = normalizeFieldName(field);

        if (normalizedField) {
          token = {
            type: normalizedField === "sort" ? "sort" : "field",
            field: normalizedField,
            operator: parseOperator(op),
            value: value.replace(/^"|"$/g, ""),
            negated: true,
            raw: full,
            startIndex: position,
            endIndex: position + full.length,
          };
        }
      }
    }

    // Pattern 3: Field filter with optional operator - field:value or field:>value
    if (!token) {
      const fieldMatch = remaining.match(/^(\w+):([<>=!]*)("[^"]*"|[^\s]*)/);
      if (fieldMatch) {
        const full = fieldMatch[0];
        const field = fieldMatch[1] ?? "";
        const op = fieldMatch[2] ?? "";
        const value = fieldMatch[3] ?? "";
        const normalizedField = normalizeFieldName(field);

        if (normalizedField) {
          token = {
            type: normalizedField === "sort" ? "sort" : "field",
            field: normalizedField,
            operator: parseOperator(op),
            value: value.replace(/^"|"$/g, ""),
            negated: false,
            raw: full,
            startIndex: position,
            endIndex: position + full.length,
          };
        }
      }
    }

    // Pattern 4: OR operator
    if (!token && remaining.toUpperCase().startsWith("OR ")) {
      token = {
        type: "operator",
        value: "OR",
        raw: remaining.slice(0, 2),
        startIndex: position,
        endIndex: position + 2,
      };
    }

    // Pattern 5: Incomplete field (for autocomplete) - field: with nothing after
    if (!token) {
      const incompleteFieldMatch = remaining.match(/^(\w+):$/);
      if (incompleteFieldMatch) {
        const full = incompleteFieldMatch[0];
        const field = incompleteFieldMatch[1] ?? "";
        const normalizedField = normalizeFieldName(field);

        if (normalizedField) {
          token = {
            type: "field",
            field: normalizedField,
            operator: "eq",
            value: "",
            raw: full,
            startIndex: position,
            endIndex: position + full.length,
          };
        }
      }
    }

    // Pattern 6: Plain word (free text)
    if (!token) {
      const wordMatch = remaining.match(/^[^\s]+/);
      if (wordMatch) {
        token = {
          type: "text",
          value: wordMatch[0],
          raw: wordMatch[0],
          startIndex: position,
          endIndex: position + wordMatch[0].length,
        };
      }
    }

    if (token) {
      tokens.push(token);
      position = token.endIndex;
    } else {
      // Safety: advance at least one character
      position++;
    }
  }

  return tokens;
}

/**
 * Normalizes field names, handling aliases
 */
function normalizeFieldName(field: string): string | null {
  const lower = field.toLowerCase();

  // Check if it's a known field
  if (ALL_FIELD_NAMES.includes(lower)) {
    // Return the canonical name if it's an alias
    return FIELD_ALIASES[lower] || lower;
  }

  return null;
}

/**
 * Parses comparison operators from the query
 */
function parseOperator(op: string): FilterOperator {
  switch (op) {
    case ">":
      return "gt";
    case "<":
      return "lt";
    case ">=":
      return "gte";
    case "<=":
      return "lte";
    case "!":
    case "!=":
      return "neq";
    default:
      return "eq";
  }
}

/**
 * Gets the token at a specific cursor position
 */
export function getTokenAtPosition(
  tokens: SearchToken[],
  position: number
): SearchToken | null {
  for (const token of tokens) {
    if (position >= token.startIndex && position <= token.endIndex) {
      return token;
    }
  }
  return null;
}

/**
 * Gets the word being typed at the cursor position (for autocomplete)
 */
export function getWordAtCursor(query: string, cursorPosition: number): string {
  // Find the start of the current word
  let start = cursorPosition;
  while (start > 0) {
    const char = query[start - 1];
    if (char === undefined || /\s/.test(char)) break;
    start--;
  }

  // Extract the word up to cursor
  return query.slice(start, cursorPosition);
}

/**
 * Checks if the cursor is positioned right after a field colon
 * e.g., "level:|" where | is cursor
 */
export function isAfterFieldColon(
  query: string,
  cursorPosition: number
): { field: string; valueStart: string } | null {
  const beforeCursor = query.slice(0, cursorPosition);
  const match = beforeCursor.match(/(\w+):([^\s]*)$/);

  if (match) {
    const field = match[1] ?? "";
    const value = match[2] ?? "";
    const normalizedField = normalizeFieldName(field);
    if (normalizedField) {
      return { field: normalizedField, valueStart: value };
    }
  }

  return null;
}
