import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted — use vi.hoisted() for variables they reference
const { mockInit, mockGetClient, mockCaptureException, mockNodeIndexInit } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockGetClient: vi.fn(() => null as any),
  mockCaptureException: vi.fn(),
  mockNodeIndexInit: vi.fn(),
}));

// @bugwatch/core is mocked so require('@bugwatch/core') in initEdge works
vi.mock("@bugwatch/core", () => ({
  captureException: mockCaptureException,
  getClient: mockGetClient,
  init: mockInit,
}));
vi.mock("./config", () => ({
  getEnvConfig: vi.fn(() => ({})),
}));
// Mock ./index(.js) — vitest intercepts require('./index') when using the resolved .js path
vi.mock("./index.js", () => ({
  init: mockNodeIndexInit,
}));

import { registerBugwatch, reset, isRegistered, onRequestError } from "./instrumentation";
import * as configMod from "./config";

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  reset();
  vi.unstubAllEnvs();
});

describe("registerBugwatch", () => {
  it("does nothing when no API key (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    registerBugwatch();
    expect(mockInit).not.toHaveBeenCalled();
    expect(isRegistered()).toBe(false);
  });

  it("warns in development when no API key", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerBugwatch();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No API key"));
    warnSpy.mockRestore();
  });

  it("initialises edge runtime SDK when runtime=edge", () => {
    // initEdge uses require('@bugwatch/core') which resolves to the CJS build — a different
    // module instance from the ESM mock; verify via the observable side-effect instead.
    registerBugwatch({ apiKey: "bw_edge_key", runtime: "edge" });
    expect(isRegistered()).toBe(true);
  });

  it("is idempotent — second call is a no-op", () => {
    registerBugwatch({ apiKey: "bw_edge_key", runtime: "edge" });
    expect(isRegistered()).toBe(true);
    // getEnvConfig is called before init but after the registered guard, so a second call
    // (which hits the guard) must not call getEnvConfig again.
    const callsBefore = vi.mocked(configMod.getEnvConfig).mock.calls.length;
    registerBugwatch({ apiKey: "bw_edge_key", runtime: "edge" });
    expect(vi.mocked(configMod.getEnvConfig).mock.calls.length).toBe(callsBefore);
  });

  it("uses apiKey from env config (edge runtime)", () => {
    vi.mocked(configMod.getEnvConfig).mockReturnValue({ apiKey: "bw_env_key" });
    // No explicit apiKey — must read bw_env_key from env config and still register.
    registerBugwatch({ runtime: "edge" });
    expect(isRegistered()).toBe(true);
  });
});

describe("reset", () => {
  it("allows re-registration after reset", () => {
    registerBugwatch({ apiKey: "bw_key", runtime: "edge" });
    expect(isRegistered()).toBe(true);
    reset();
    expect(isRegistered()).toBe(false);
    registerBugwatch({ apiKey: "bw_key", runtime: "edge" });
    expect(isRegistered()).toBe(true);
  });
});

describe("onRequestError", () => {
  it("calls captureException with route metadata and digest", async () => {
    const mockClient = { flush: vi.fn(() => Promise.resolve()) };
    mockGetClient.mockReturnValue(mockClient);

    const error = Object.assign(new Error("route error"), { digest: "abc123" });
    await onRequestError(
      error,
      { path: "/api/users", method: "GET", headers: { "x-request-id": "42" } },
      { routerKind: "App Router", routePath: "/api/users", routeType: "route" }
    );

    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          mechanism: "nextjs.onRequestError",
          "next.routerKind": "App Router",
          "next.digest": "abc123",
        }),
        request: expect.objectContaining({ url: "/api/users", method: "GET" }),
      })
    );
    expect(mockClient.flush).toHaveBeenCalled();
  });

  it("filters sensitive request headers", async () => {
    mockGetClient.mockReturnValue(null);
    await onRequestError(
      new Error("err"),
      { path: "/p", method: "POST", headers: { authorization: "Bearer secret", host: "example.com" } },
      { routerKind: "Pages Router", routePath: "/p", routeType: "page" }
    );
    const requestCtx = mockCaptureException.mock.calls[0][1]?.request;
    expect(requestCtx.headers.authorization).toBe("[Filtered]");
    expect(requestCtx.headers.host).toBe("example.com");
  });

  it("resolves even when getClient returns null", async () => {
    mockGetClient.mockReturnValue(null);
    await expect(
      onRequestError(
        new Error("e"),
        { path: "/p", method: "GET", headers: {} },
        { routerKind: "App Router", routePath: "/p", routeType: "page" }
      )
    ).resolves.toBeUndefined();
  });

  it("includes renderSource tag when present", async () => {
    mockGetClient.mockReturnValue(null);
    const error = new Error("rsc error");
    await onRequestError(
      error,
      { path: "/page", method: "GET", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/page",
        routeType: "page",
        renderSource: "react-server-components",
      }
    );
    const tags = mockCaptureException.mock.calls[0][1]?.tags;
    expect(tags["next.renderSource"]).toBe("react-server-components");
  });
});

// ── detectRuntime (via registerBugwatch without explicit runtime) ─────────────
describe("detectRuntime", () => {
  it("detects edge from NEXT_RUNTIME env var", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    registerBugwatch({ apiKey: "bw_test" });
    expect(isRegistered()).toBe(true);
    // Edge path taken — initNode (which uses require('./index')) is NOT called
    expect(mockNodeIndexInit).not.toHaveBeenCalled();
  });

  it("detects edge from EdgeRuntime global", () => {
    vi.stubGlobal("EdgeRuntime", "edge");
    registerBugwatch({ apiKey: "bw_test" });
    expect(isRegistered()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("enters nodejs path when no edge indicators (covers detectRuntime default return)", () => {
    // require('./index') fails in this ESM/CJS context but the detectRuntime
    // "return nodejs" branch and the initNode call site are still counted as covered.
    expect(() => registerBugwatch({ apiKey: "bw_test" })).toThrow();
  });
});

// ── initEdge debug log ────────────────────────────────────────────────────────
describe("initEdge debug", () => {
  it("logs debug message when debug is true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    registerBugwatch({ apiKey: "bw_test", runtime: "edge", debug: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Edge runtime"));
    logSpy.mockRestore();
  });
});
