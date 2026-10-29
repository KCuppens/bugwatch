import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ENV_VARS, getEnvConfig, validateApiKey, hasApiKey } from "./env";

describe("env.ts", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------
  // ENV_VARS constant
  // -------------------------------------------------------------------
  describe("ENV_VARS", () => {
    it("has the expected keys", () => {
      expect(ENV_VARS.API_KEY).toBe("BUGWATCH_API_KEY");
      expect(ENV_VARS.ENVIRONMENT).toBe("BUGWATCH_ENVIRONMENT");
      expect(ENV_VARS.RELEASE).toBe("BUGWATCH_RELEASE");
      expect(ENV_VARS.DEBUG).toBe("BUGWATCH_DEBUG");
      expect(ENV_VARS.ENDPOINT).toBe("BUGWATCH_ENDPOINT");
    });

    it("contains exactly the documented keys", () => {
      expect(Object.keys(ENV_VARS).sort()).toEqual(["API_KEY", "DEBUG", "ENDPOINT", "ENVIRONMENT", "RELEASE"].sort());
    });
  });

  // -------------------------------------------------------------------
  // getEnvConfig
  // -------------------------------------------------------------------
  describe("getEnvConfig", () => {
    it("returns full config when all env vars are set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_abc");
      vi.stubEnv("BUGWATCH_ENVIRONMENT", "production");
      vi.stubEnv("BUGWATCH_RELEASE", "1.0.0");
      vi.stubEnv("BUGWATCH_DEBUG", "true");
      vi.stubEnv("BUGWATCH_ENDPOINT", "https://example.com");

      const cfg = getEnvConfig();
      expect(cfg.apiKey).toBe("bw_live_abc");
      expect(cfg.environment).toBe("production");
      expect(cfg.release).toBe("1.0.0");
      expect(cfg.debug).toBe(true);
      expect(cfg.endpoint).toBe("https://example.com");
    });

    it("returns empty config when no env vars set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "");
      vi.stubEnv("BUGWATCH_ENVIRONMENT", "");
      vi.stubEnv("BUGWATCH_RELEASE", "");
      vi.stubEnv("BUGWATCH_DEBUG", "");
      vi.stubEnv("BUGWATCH_ENDPOINT", "");

      const cfg = getEnvConfig();
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.environment).toBeUndefined();
      expect(cfg.release).toBeUndefined();
      expect(cfg.debug).toBeUndefined();
      expect(cfg.endpoint).toBeUndefined();
    });

    it("only includes apiKey when only API_KEY is set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_only");
      vi.stubEnv("BUGWATCH_ENVIRONMENT", "");
      vi.stubEnv("BUGWATCH_RELEASE", "");
      vi.stubEnv("BUGWATCH_DEBUG", "");
      vi.stubEnv("BUGWATCH_ENDPOINT", "");

      const cfg = getEnvConfig();
      expect(cfg.apiKey).toBe("bw_live_only");
      expect(cfg.environment).toBeUndefined();
      expect(cfg.release).toBeUndefined();
      expect(cfg.debug).toBeUndefined();
      expect(cfg.endpoint).toBeUndefined();
    });

    it('DEBUG="true" sets debug: true', () => {
      vi.stubEnv("BUGWATCH_DEBUG", "true");
      const cfg = getEnvConfig();
      expect(cfg.debug).toBe(true);
    });

    it('DEBUG="false" does not set debug field', () => {
      vi.stubEnv("BUGWATCH_DEBUG", "false");
      const cfg = getEnvConfig();
      expect(cfg.debug).toBeUndefined();
    });

    it('DEBUG="1" does not set debug field (only "true" enables)', () => {
      vi.stubEnv("BUGWATCH_DEBUG", "1");
      const cfg = getEnvConfig();
      expect(cfg.debug).toBeUndefined();
    });

    it("does not trim whitespace — passes raw value through", () => {
      // Source does not trim, so "  bw_live_xx  " should arrive verbatim.
      vi.stubEnv("BUGWATCH_API_KEY", "  bw_live_xx  ");
      const cfg = getEnvConfig();
      expect(cfg.apiKey).toBe("  bw_live_xx  ");
    });

    it('DEBUG=" true " (whitespace) does NOT enable debug (no trim)', () => {
      vi.stubEnv("BUGWATCH_DEBUG", " true ");
      const cfg = getEnvConfig();
      expect(cfg.debug).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // validateApiKey
  // -------------------------------------------------------------------
  describe("validateApiKey", () => {
    it("throws on undefined with helpful message about BUGWATCH_API_KEY", () => {
      expect(() => validateApiKey(undefined)).toThrow(/BUGWATCH_API_KEY/);
      expect(() => validateApiKey(undefined)).toThrow(/Bugwatch: API key required/);
    });

    it("throws on empty string", () => {
      expect(() => validateApiKey("")).toThrow(/BUGWATCH_API_KEY/);
    });

    it('logs warning with first 6 chars + "..." for long invalid keys', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateApiKey("invalid-key-zzz"); // length 15, no bw_ prefix
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]![0] as string;
      expect(msg).toContain("invali...");
      expect(msg).toContain("bw_");
    });

    it('logs warning with "[hidden]" for short invalid keys', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateApiKey("short"); // length 5, no bw_ prefix
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]![0] as string;
      expect(msg).toContain("[hidden]");
      expect(msg).not.toContain("short");
    });

    it("treats length===10 as short (uses [hidden])", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateApiKey("1234567890"); // length === 10 -> [hidden]
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]![0] as string;
      expect(msg).toContain("[hidden]");
    });

    it("does not throw or warn for valid bw_ prefix keys", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => validateApiKey("bw_live_xxxxxxxx")).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // hasApiKey
  // -------------------------------------------------------------------
  describe("hasApiKey", () => {
    it("returns true when explicit key passed", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "");
      expect(hasApiKey("bw_live_xx")).toBe(true);
    });

    it("returns true when env var set, no explicit key", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "bw_live_env");
      expect(hasApiKey()).toBe(true);
    });

    it("returns false when neither set", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "");
      expect(hasApiKey()).toBe(false);
      expect(hasApiKey(undefined)).toBe(false);
    });

    it("returns false on empty string explicit key with no env var", () => {
      vi.stubEnv("BUGWATCH_API_KEY", "");
      expect(hasApiKey("")).toBe(false);
    });
  });
});
