import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  shouldDenyUrl,
  shouldAllowUrl,
  shouldDropByLevel,
  isBrowserNoise,
  sessionErrorCounter,
  BROWSER_NOISE_PATTERNS,
} from "./filters";

// Reset the singleton between tests
beforeEach(() => {
  sessionErrorCounter.reset();
});

// ---------------------------------------------------------------------------
// shouldDenyUrl
// ---------------------------------------------------------------------------
describe("shouldDenyUrl", () => {
  it("returns false when denyUrls is empty", () => {
    expect(shouldDenyUrl(["https://myapp.com/bundle.js"], undefined, [])).toBe(false);
  });

  it("returns false when filenames and sourceUrl are empty", () => {
    expect(shouldDenyUrl([], undefined, ["gtm.js"])).toBe(false);
  });

  it("matches a string pattern as substring of filename", () => {
    expect(shouldDenyUrl(["https://www.googletagmanager.com/gtm.js"], undefined, ["gtm.js"])).toBe(true);
  });

  it("matches a RegExp pattern against filename", () => {
    expect(shouldDenyUrl(["https://connect.facebook.net/en_US/fbevents.js"], undefined, [/facebook\.net/i])).toBe(true);
  });

  it("matches sourceUrl when filenames are empty", () => {
    expect(shouldDenyUrl([], "https://www.googletagmanager.com/gtm.js", ["gtm.js"])).toBe(true);
  });

  it("matches sourceUrl alongside filenames", () => {
    expect(
      shouldDenyUrl(["https://myapp.com/app.js"], "https://ad.doubleclick.net/pixel.js", ["doubleclick.net"])
    ).toBe(true);
  });

  it("returns false when no filename or sourceUrl matches", () => {
    expect(shouldDenyUrl(["https://myapp.com/bundle.js"], "https://myapp.com/chunk.js", ["gtm.js"])).toBe(false);
  });

  it("drops when any frame matches (not all must match)", () => {
    expect(
      shouldDenyUrl(["https://myapp.com/app.js", "https://hotjar.com/tracker.js"], undefined, ["hotjar.com"])
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldAllowUrl
// ---------------------------------------------------------------------------
describe("shouldAllowUrl", () => {
  it("returns true when allowUrls is empty (allow everything)", () => {
    expect(shouldAllowUrl(["https://random.com/script.js"], undefined, [])).toBe(true);
  });

  it("returns true when filenames and sourceUrl are both empty (stackless — pass through)", () => {
    expect(shouldAllowUrl([], undefined, ["myapp.com"])).toBe(true);
  });

  it("returns true when a filename matches the allowlist", () => {
    expect(shouldAllowUrl(["https://myapp.com/bundle.js"], undefined, ["myapp.com"])).toBe(true);
  });

  it("returns false when filenames are set but none match", () => {
    expect(shouldAllowUrl(["https://cdn.third-party.com/lib.js"], undefined, ["myapp.com"])).toBe(false);
  });

  it("returns true when sourceUrl matches the allowlist (even if no frames match)", () => {
    expect(shouldAllowUrl([], "https://myapp.com/inline.js", ["myapp.com"])).toBe(true);
  });

  it("returns false when sourceUrl is set and neither frames nor sourceUrl match", () => {
    expect(shouldAllowUrl(["https://cdn.other.com/lib.js"], "https://cdn.other.com/chunk.js", ["myapp.com"])).toBe(
      false
    );
  });

  it("supports RegExp allowUrls patterns", () => {
    expect(shouldAllowUrl(["https://app.example.com/main.js"], undefined, [/example\.com/])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldDropByLevel
// ---------------------------------------------------------------------------
describe("shouldDropByLevel", () => {
  it("drops debug when minLevel is info", () => {
    expect(shouldDropByLevel("debug", "info")).toBe(true);
  });

  it("drops info when minLevel is warning", () => {
    expect(shouldDropByLevel("info", "warning")).toBe(true);
  });

  it("drops warning when minLevel is error", () => {
    expect(shouldDropByLevel("warning", "error")).toBe(true);
  });

  it("drops error when minLevel is fatal", () => {
    expect(shouldDropByLevel("error", "fatal")).toBe(true);
  });

  it("does NOT drop when level equals minLevel", () => {
    expect(shouldDropByLevel("error", "error")).toBe(false);
  });

  it("does NOT drop when level exceeds minLevel", () => {
    expect(shouldDropByLevel("fatal", "error")).toBe(false);
    expect(shouldDropByLevel("error", "warning")).toBe(false);
    expect(shouldDropByLevel("warning", "info")).toBe(false);
    expect(shouldDropByLevel("info", "debug")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBrowserNoise
// ---------------------------------------------------------------------------
describe("isBrowserNoise", () => {
  it("matches 'Script error.'", () => {
    expect(isBrowserNoise(new Error("Script error."))).toBe(true);
  });

  it("matches 'Script error' (without period)", () => {
    expect(isBrowserNoise(new Error("Script error"))).toBe(true);
  });

  it("matches ResizeObserver loop limit exceeded", () => {
    expect(isBrowserNoise(new Error("ResizeObserver loop limit exceeded"))).toBe(true);
  });

  it("matches ResizeObserver loop completed with undelivered notifications", () => {
    expect(isBrowserNoise(new Error("ResizeObserver loop completed with undelivered notifications"))).toBe(true);
  });

  it("matches AbortError prefix", () => {
    expect(isBrowserNoise(new Error("AbortError: The user aborted a request."))).toBe(true);
  });

  it("matches NetworkError: Load failed", () => {
    expect(isBrowserNoise(new Error("NetworkError: Load failed"))).toBe(true);
  });

  it("matches NetworkError: Failed to fetch", () => {
    expect(isBrowserNoise(new Error("NetworkError: Failed to fetch"))).toBe(true);
  });

  it("matches ChunkLoadError", () => {
    expect(isBrowserNoise(new Error("ChunkLoadError: Loading chunk 42 failed."))).toBe(true);
  });

  it("matches Loading chunk N failed", () => {
    expect(isBrowserNoise(new Error("Loading chunk 7 failed"))).toBe(true);
  });

  it("matches Loading CSS chunk N failed", () => {
    expect(isBrowserNoise(new Error("Loading CSS chunk 3 failed"))).toBe(true);
  });

  it("matches 'Load failed' (Safari unload)", () => {
    expect(isBrowserNoise(new Error("Load failed"))).toBe(true);
  });

  it("matches Firefox unload fetch abort", () => {
    expect(isBrowserNoise(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
  });

  it("does NOT match a real application error", () => {
    expect(isBrowserNoise(new Error("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
    expect(isBrowserNoise(new Error("Unexpected token '<'"))).toBe(false);
  });

  it("handles null/undefined error.message without throwing", () => {
    const error = new Error();
     
    (error as any).message = null;
    expect(() => isBrowserNoise(error)).not.toThrow();
    expect(isBrowserNoise(error)).toBe(false);
  });

  it("BROWSER_NOISE_PATTERNS exports the full list and is frozen", () => {
    expect(BROWSER_NOISE_PATTERNS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(BROWSER_NOISE_PATTERNS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SessionErrorCounter
// ---------------------------------------------------------------------------
describe("sessionErrorCounter", () => {
  it("isLimitReached(0) always returns false (disabled)", () => {
    expect(sessionErrorCounter.isLimitReached(0)).toBe(false);
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(0)).toBe(false);
  });

  it("allows events until limit is reached", () => {
    expect(sessionErrorCounter.isLimitReached(3)).toBe(false);
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(false);
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(false);
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(true);
  });

  it("stays at limit after exceeding it", () => {
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(true);
  });

  it("reset() brings the counter back to zero", () => {
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(true);
    sessionErrorCounter.reset();
    expect(sessionErrorCounter.isLimitReached(3)).toBe(false);
  });

  it("isLimitReached with negative max always returns false", () => {
    sessionErrorCounter.increment();
    sessionErrorCounter.increment();
    expect(sessionErrorCounter.isLimitReached(-5)).toBe(false);
    expect(sessionErrorCounter.isLimitReached(-1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesPattern — resilience (pattern throws)
// ---------------------------------------------------------------------------
describe("matchesPattern resilience (via shouldDenyUrl)", () => {
  it("does not throw when a RegExp pattern itself throws during test()", () => {
    // Simulate a pattern that throws by using a sticky regex in an unusual state
    const throwingPattern = /x/;
    const origTest = throwingPattern.test.bind(throwingPattern);
    vi.spyOn(throwingPattern, "test").mockImplementationOnce(() => {
      throw new Error("regex engine failure");
    });

    expect(() => shouldDenyUrl(["https://myapp.com/app.js"], undefined, [throwingPattern])).not.toThrow();

    vi.restoreAllMocks();
    void origTest;
  });

  it("continues to next pattern after a throwing pattern", () => {
    const throwingPattern = /x/;
    vi.spyOn(throwingPattern, "test").mockImplementationOnce(() => {
      throw new Error("catastrophic backtrack");
    });

    // Second pattern matches — result should be true despite first pattern throwing
    const result = shouldDenyUrl(["https://cdn.ad-network.com/pixel.js"], undefined, [
      throwingPattern,
      "ad-network.com",
    ]);
    expect(result).toBe(true);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// shouldDropByLevel — edge cases
// ---------------------------------------------------------------------------
describe("shouldDropByLevel — edge cases", () => {
  it("returns false (allow through) when eventLevel is an unknown value", () => {
    // TypeScript prevents this at compile time but runtime may encounter it
     
    expect(shouldDropByLevel("critical" as any, "error")).toBe(false);
  });

  it("returns false when minLevel is an unknown value", () => {
     
    expect(shouldDropByLevel("error", "severe" as any)).toBe(false);
  });
});
