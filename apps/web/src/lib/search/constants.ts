// Search field definitions and constants

export interface FieldConfig {
  type: "enum" | "number" | "date" | "text";
  values?: readonly string[];
  operators?: readonly string[];
  description: string;
  aliases?: readonly string[];
}

export const SEARCH_FIELDS: Record<string, FieldConfig> = {
  // Status field (using 'is' as the key like GitHub)
  is: {
    type: "enum",
    values: ["unresolved", "resolved", "ignored"] as const,
    description: "Issue status",
    aliases: ["status"],
  },
  // Level field
  level: {
    type: "enum",
    values: ["fatal", "error", "warning", "info"] as const,
    description: "Error severity level",
    aliases: ["severity"],
  },
  // Numeric fields
  count: {
    type: "number",
    operators: ["eq", "gt", "lt", "gte", "lte"] as const,
    description: "Event count",
    aliases: ["events"],
  },
  users: {
    type: "number",
    operators: ["eq", "gt", "lt", "gte", "lte"] as const,
    description: "Affected users count",
    aliases: ["user_count"],
  },
  // Date fields
  first_seen: {
    type: "date",
    operators: ["eq", "gt", "lt"] as const,
    description: "First occurrence date",
    aliases: ["created", "opened"],
  },
  last_seen: {
    type: "date",
    operators: ["eq", "gt", "lt"] as const,
    description: "Last occurrence date",
    aliases: ["updated", "recent"],
  },
  // Text fields
  title: {
    type: "text",
    description: "Issue title",
    aliases: ["message", "error"],
  },
  fingerprint: {
    type: "text",
    description: "Issue fingerprint",
    aliases: ["hash", "id"],
  },
} as const;

export const SORT_FIELDS = ["count", "users", "last_seen", "first_seen"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const RELATIVE_TIME_UNITS: Record<string, string> = {
  h: "hours",
  d: "days",
  w: "weeks",
  m: "months",
};

export const DATE_SHORTCUTS = [
  { label: "today", description: "Today" },
  { label: "yesterday", description: "Yesterday" },
  { label: "7d", description: "Last 7 days" },
  { label: "14d", description: "Last 14 days" },
  { label: "30d", description: "Last 30 days" },
  { label: "90d", description: "Last 90 days" },
] as const;

// Level colors for UI
export const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  fatal: {
    bg: "bg-red-500/10",
    text: "text-red-500",
    border: "border-red-500",
  },
  error: {
    bg: "bg-orange-500/10",
    text: "text-orange-500",
    border: "border-orange-500",
  },
  warning: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-500",
    border: "border-yellow-500",
  },
  info: {
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500",
  },
};

// Status colors for UI
export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  unresolved: {
    bg: "bg-red-500/10",
    text: "text-red-500",
  },
  resolved: {
    bg: "bg-green-500/10",
    text: "text-green-500",
  },
  ignored: {
    bg: "bg-gray-500/10",
    text: "text-gray-500",
  },
};

// Field icons for autocomplete
export const FIELD_ICONS: Record<string, string> = {
  is: "circle-dot",
  level: "alert-triangle",
  count: "hash",
  users: "users",
  first_seen: "calendar",
  last_seen: "clock",
  title: "type",
  fingerprint: "fingerprint",
};

// Build a reverse lookup for aliases
export const FIELD_ALIASES: Record<string, string> = {};
Object.entries(SEARCH_FIELDS).forEach(([field, config]) => {
  config.aliases?.forEach((alias) => {
    FIELD_ALIASES[alias] = field;
  });
});

// All searchable field names (including aliases)
export const ALL_FIELD_NAMES = [
  ...Object.keys(SEARCH_FIELDS),
  ...Object.keys(FIELD_ALIASES),
  "sort",
];
