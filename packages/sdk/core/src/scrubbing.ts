/**
 * PII scrubbing — recursively walks event payloads and masks values whose
 * keys or string contents match known sensitive patterns. Pure, side-effect
 * free, returns a new object (deep-cloned) so original references stay intact.
 */
import type { ErrorEvent, SanitizeOptions } from "./types";

const REDACTED = "[Filtered]";

/**
 * Default sensitive key substrings (case-insensitive).
 * Matches if a key *contains* any of these.
 */
const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "bearer",
  "authorization",
  "cookie",
  "set-cookie",
  "session",
  "credit_card",
  "creditcard",
  "cc_number",
  "card_number",
  "cvv",
  "cvc",
  "ssn",
  "social_security",
  "private_key",
  "client_secret",
  "signature",
];

/**
 * Default value patterns matched against string values.
 * Matches anywhere in the string. False positives prefer leaving data alone —
 * we only redact full matches we're confident about.
 */
const DEFAULT_VALUE_PATTERNS: readonly RegExp[] = [
  // JWT (3 base64url segments)
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  // AWS access key
  /\bAKIA[0-9A-Z]{16}\b/,
  // US SSN dashed
  /\b\d{3}-\d{2}-\d{4}\b/,
  // Stripe-style secret keys (sk_live_..., sk_test_...)
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  // Slack tokens (xox*)
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  // GitHub PAT
  /\bghp_[A-Za-z0-9]{36}\b/,
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;

interface CompiledOptions {
  keySet: string[];
  patterns: RegExp[];
  scrubEmails: boolean;
}

function compileOptions(opts: SanitizeOptions | undefined): CompiledOptions {
  const userKeys = opts?.sensitiveKeys || [];
  const keySet = [...DEFAULT_SENSITIVE_KEYS, ...userKeys].map((k) =>
    k.toLowerCase()
  );
  const patterns: RegExp[] = [
    ...DEFAULT_VALUE_PATTERNS,
    ...(opts?.customPatterns || []),
  ];
  return {
    keySet,
    patterns,
    scrubEmails: opts?.scrubEmails === true,
  };
}

function keyIsSensitive(key: string, keySet: string[]): boolean {
  const lower = key.toLowerCase();
  for (const needle of keySet) {
    if (lower.includes(needle)) return true;
  }
  return false;
}

/**
 * Luhn check — used to reduce credit-card false positives on numeric runs.
 * Strips spaces/dashes first, then runs the standard Luhn algorithm.
 */
function luhnCheck(s: string): boolean {
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function valueIsSensitive(value: string, opts: CompiledOptions): boolean {
  for (const re of opts.patterns) {
    if (re.test(value)) return true;
  }
  if (opts.scrubEmails && EMAIL_PATTERN.test(value)) return true;
  // Credit cards: only flag if Luhn-valid to avoid masking timestamps, IDs, etc.
  if (CREDIT_CARD_PATTERN.test(value) && luhnCheck(value)) return true;
  return false;
}

/**
 * Recursive walker. Replaces sensitive values with "[Filtered]". Preserves
 * shape — never deletes keys. Handles cycles.
 */
function scrubValue(
  value: unknown,
  opts: CompiledOptions,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (depth > 8) return value;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return valueIsSensitive(value, opts) ? REDACTED : value;
  }

  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, opts, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyIsSensitive(k, opts.keySet)) {
      out[k] = REDACTED;
    } else {
      out[k] = scrubValue(v, opts, seen, depth + 1);
    }
  }
  return out;
}

/**
 * Scrub an entire ErrorEvent in place-safe way (returns a new event,
 * leaves the input untouched). Pass `enabled: false` to short-circuit.
 */
export function scrubEvent(
  event: ErrorEvent,
  options: SanitizeOptions | undefined
): ErrorEvent {
  if (options?.enabled === false) return event;
  const compiled = compileOptions(options);
  const seen = new WeakSet<object>();

  return {
    ...event,
    extra: event.extra
      ? (scrubValue(event.extra, compiled, seen, 0) as Record<string, unknown>)
      : event.extra,
    user: event.user
      ? // user.id and user.email get special treatment — id stays, email is
        // optional based on scrubEmails flag (treated as a value scrub)
        (scrubValue(event.user, compiled, seen, 0) as ErrorEvent["user"])
      : event.user,
    tags: event.tags
      ? (scrubValue(event.tags, compiled, seen, 0) as Record<string, string>)
      : event.tags,
    request: event.request
      ? {
          ...event.request,
          headers: event.request.headers
            ? (scrubValue(
                event.request.headers,
                compiled,
                seen,
                0
              ) as Record<string, string>)
            : event.request.headers,
          data: event.request.data
            ? scrubValue(event.request.data, compiled, seen, 0)
            : event.request.data,
        }
      : event.request,
    breadcrumbs: event.breadcrumbs
      ? event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data
            ? (scrubValue(b.data, compiled, seen, 0) as Record<string, unknown>)
            : b.data,
        }))
      : event.breadcrumbs,
  };
}

// Re-export internals for testing
export const __test = {
  keyIsSensitive,
  valueIsSensitive,
  luhnCheck,
  compileOptions,
  scrubValue,
  DEFAULT_SENSITIVE_KEYS,
};
