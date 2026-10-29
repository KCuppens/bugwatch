import type { ErrorEvent } from "./types";

const LEVEL_ORDER: Record<ErrorEvent["level"], number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

// Frozen so downstream consumers cannot accidentally mutate the global list
export const BROWSER_NOISE_PATTERNS: readonly RegExp[] = Object.freeze([
  // Cross-origin errors with no usable info
  /^Script error\.?$/i,
  // ResizeObserver timing noise — fired in tight layout loops, always benign
  /^ResizeObserver loop limit exceeded$/i,
  /^ResizeObserver loop completed with undelivered notifications\.?$/i,
  // AbortError from fetch when user navigates away (intentional cancellation)
  /^AbortError/i,
  // Network failure during page unload (browser killed the request)
  /^NetworkError: Load failed$/i,
  /^NetworkError: Failed to fetch$/i,
  // Webpack/dynamic-import chunk loading failures (CDN/deploy race)
  /^ChunkLoadError: Loading chunk \d+ failed/i,
  /^Loading chunk \d+ failed/i,
  /^Loading CSS chunk \d+ failed/i,
  // Safari-specific "load failed" on fetch during navigation
  /^Load failed$/i,
  // Firefox unload fetch abort
  /^NetworkError when attempting to fetch resource\.?$/i,
]);

function matchesPattern(url: string, patterns: (string | RegExp)[]): boolean {
  for (const pattern of patterns) {
    try {
      if (typeof pattern === "string") {
        if (url.includes(pattern)) return true;
      } else if (pattern.test(url)) {
        return true;
      }
    } catch {
      // Pattern threw (catastrophic backtracking, invalid state, etc.) — skip it
    }
  }
  return false;
}

/**
 * Returns true when the error should be dropped because a stack frame
 * filename or sourceUrl matches a denyUrls pattern.
 */
export function shouldDenyUrl(
  filenames: string[],
  sourceUrl: string | undefined,
  denyUrls: (string | RegExp)[]
): boolean {
  if (!denyUrls || denyUrls.length === 0) return false;
  const urls = sourceUrl ? [...filenames, sourceUrl] : filenames;
  return urls.some((url) => matchesPattern(url, denyUrls));
}

/**
 * Returns true when the error should be allowed through.
 * Returns false (i.e. should drop) when allowUrls is non-empty and no
 * stack frame filename or sourceUrl matches any pattern.
 *
 * Stackless errors (empty filenames, no sourceUrl) are always allowed
 * through to avoid silent blind spots in cross-origin environments.
 */
export function shouldAllowUrl(
  filenames: string[],
  sourceUrl: string | undefined,
  allowUrls: (string | RegExp)[]
): boolean {
  if (!allowUrls || allowUrls.length === 0) return true;
  if (filenames.length === 0 && !sourceUrl) return true;
  const urls = sourceUrl ? [...filenames, sourceUrl] : filenames;
  return urls.some((url) => matchesPattern(url, allowUrls));
}

/**
 * Returns true when eventLevel is below minLevel (event should be dropped).
 * Returns false (allow through) if either level is not in the known set.
 */
export function shouldDropByLevel(eventLevel: ErrorEvent["level"], minLevel: ErrorEvent["level"]): boolean {
  const eventRank = LEVEL_ORDER[eventLevel];
  const minRank = LEVEL_ORDER[minLevel];
  if (eventRank === undefined || minRank === undefined) {
    return false;
  }
  return eventRank < minRank;
}

/**
 * Returns true when error.message matches a known-useless browser noise pattern.
 */
export function isBrowserNoise(error: Error): boolean {
  const message = String(error.message ?? "");
  return BROWSER_NOISE_PATTERNS.some((pattern) => {
    try {
      return pattern.test(message);
    } catch {
      return false;
    }
  });
}

class SessionErrorCounter {
  private count = 0;

  increment(): void {
    this.count++;
  }

  /** Returns true when max > 0 and count has reached or exceeded max. */
  isLimitReached(max: number): boolean {
    return max > 0 && this.count >= max;
  }

  reset(): void {
    this.count = 0;
  }
}

/** Module-level singleton — resets automatically on page reload. */
export const sessionErrorCounter = new SessionErrorCounter();
