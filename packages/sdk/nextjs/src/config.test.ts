import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnvConfig, hasApiKey } from "./config";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEnvConfig", () => {
  it("returns empty config when no env vars are set", () => {
    expect(getEnvConfig()).toEqual({});
  });

  it("reads BUGWATCH_API_KEY", () => {
    vi.stubEnv("BUGWATCH_API_KEY", "bw_server_key");
    expect(getEnvConfig().apiKey).toBe("bw_server_key");
  });

  it("reads NEXT_PUBLIC_BUGWATCH_API_KEY when server key absent", () => {
    vi.stubEnv("NEXT_PUBLIC_BUGWATCH_API_KEY", "bw_public_key");
    expect(getEnvConfig().apiKey).toBe("bw_public_key");
  });

  it("prefers BUGWATCH_API_KEY over NEXT_PUBLIC_", () => {
    vi.stubEnv("BUGWATCH_API_KEY", "server");
    vi.stubEnv("NEXT_PUBLIC_BUGWATCH_API_KEY", "public");
    expect(getEnvConfig().apiKey).toBe("server");
  });

  it("reads BUGWATCH_ENVIRONMENT", () => {
    vi.stubEnv("BUGWATCH_ENVIRONMENT", "staging");
    expect(getEnvConfig().environment).toBe("staging");
  });

  it("reads NEXT_PUBLIC_BUGWATCH_ENVIRONMENT", () => {
    vi.stubEnv("NEXT_PUBLIC_BUGWATCH_ENVIRONMENT", "preview");
    expect(getEnvConfig().environment).toBe("preview");
  });

  it("reads BUGWATCH_RELEASE", () => {
    vi.stubEnv("BUGWATCH_RELEASE", "v1.2.3");
    expect(getEnvConfig().release).toBe("v1.2.3");
  });

  it('sets debug=true when BUGWATCH_DEBUG is "true"', () => {
    vi.stubEnv("BUGWATCH_DEBUG", "true");
    expect(getEnvConfig().debug).toBe(true);
  });

  it('does not set debug when BUGWATCH_DEBUG is not "true"', () => {
    vi.stubEnv("BUGWATCH_DEBUG", "false");
    expect(getEnvConfig().debug).toBeUndefined();
  });

  it("reads BUGWATCH_ENDPOINT", () => {
    vi.stubEnv("BUGWATCH_ENDPOINT", "https://custom.endpoint.com");
    expect(getEnvConfig().endpoint).toBe("https://custom.endpoint.com");
  });

  it("reads NEXT_PUBLIC_BUGWATCH_ENDPOINT", () => {
    vi.stubEnv("NEXT_PUBLIC_BUGWATCH_ENDPOINT", "https://public.endpoint.com");
    expect(getEnvConfig().endpoint).toBe("https://public.endpoint.com");
  });
});

describe("hasApiKey", () => {
  it("returns false when no key is set", () => {
    expect(hasApiKey()).toBe(false);
  });

  it("returns true when BUGWATCH_API_KEY is set", () => {
    vi.stubEnv("BUGWATCH_API_KEY", "bw_key");
    expect(hasApiKey()).toBe(true);
  });

  it("returns true when NEXT_PUBLIC_BUGWATCH_API_KEY is set", () => {
    vi.stubEnv("NEXT_PUBLIC_BUGWATCH_API_KEY", "bw_pub_key");
    expect(hasApiKey()).toBe(true);
  });
});
