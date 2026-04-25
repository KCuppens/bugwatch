import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted — use vi.hoisted() for variables they reference
const { mockSetTag, mockClient, mockNodeInit } = vi.hoisted(() => {
  const mockSetTag = vi.fn();
  const mockClient = { setTag: mockSetTag };
  const mockNodeInit = vi.fn(() => mockClient);
  return { mockSetTag, mockClient, mockNodeInit };
});

vi.mock("@bugwatch/node", () => ({ init: mockNodeInit }));
vi.mock("@bugwatch/core", () => ({
  captureException: vi.fn(() => "evt-id"),
  captureMessage: vi.fn(() => "msg-id"),
  addBreadcrumb: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setExtra: vi.fn(),
  getClient: vi.fn(() => null),
}));

import { init, withBugwatch, withBugwatchServerSideProps, withBugwatchStaticProps, withBugwatchApi } from "./index";
import * as core from "@bugwatch/core";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockNodeInit.mockReturnValue(mockClient);
});

// ── init ──────────────────────────────────────────────────────────────────────
describe("init", () => {
  it("calls nodeInit with provided options", () => {
    init({ apiKey: "bw_key" });
    expect(mockNodeInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "bw_key" }));
  });

  it("sets framework and runtime tags on the client", () => {
    init({ apiKey: "bw_key" });
    expect(mockSetTag).toHaveBeenCalledWith("framework", "nextjs");
    expect(mockSetTag).toHaveBeenCalledWith("next.runtime", expect.any(String));
  });

  it("logs when debug is true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    init({ apiKey: "bw_key", debug: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[Bugwatch]"));
    logSpy.mockRestore();
  });

  it("detects nodejs runtime from NEXT_RUNTIME env var", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    init({ apiKey: "bw_key" });
    expect(mockSetTag).toHaveBeenCalledWith("next.runtime", "nodejs");
  });

  it("detects edge runtime from NEXT_RUNTIME env var", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    init({ apiKey: "bw_key" });
    expect(mockSetTag).toHaveBeenCalledWith("next.runtime", "edge");
  });

  it("detects edge runtime from EdgeRuntime global", () => {
    vi.stubGlobal("EdgeRuntime", "edge");
    init({ apiKey: "bw_key" });
    expect(mockSetTag).toHaveBeenCalledWith("next.runtime", "edge");
    vi.unstubAllGlobals();
  });
});

// ── withBugwatch ──────────────────────────────────────────────────────────────
describe("withBugwatch", () => {
  it("returns a function that returns a NextConfig", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const result = configFn({});
    expect(result).toBeDefined();
    expect(typeof result.webpack).toBe("function");
  });

  it("calls init when apiKey is provided (window is undefined in Node env)", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    configFn({});
    expect(mockNodeInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "bw_key" }));
  });

  it("does not call init when no apiKey", () => {
    const configFn = withBugwatch({} as any);
    configFn({});
    expect(mockNodeInit).not.toHaveBeenCalled();
  });

  it("uses default empty config when called with no argument", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    expect(() => configFn()).not.toThrow();
  });

  it("passes through existing nextConfig properties", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const result = configFn({ reactStrictMode: true });
    expect((result as any).reactStrictMode).toBe(true);
  });

  it("adds hidden-source-map devtool in production non-server build", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const nextConfig = configFn({});
    const webpackConfig: any = {};
    nextConfig.webpack!(webpackConfig, { dev: false, isServer: false } as any);
    expect(webpackConfig.devtool).toBe("hidden-source-map");
  });

  it("does not set source map in dev mode", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const nextConfig = configFn({});
    const webpackConfig: any = {};
    nextConfig.webpack!(webpackConfig, { dev: true, isServer: false } as any);
    expect(webpackConfig.devtool).toBeUndefined();
  });

  it("calls existing webpack function when provided", () => {
    const originalWebpack = vi.fn(() => ({ custom: "config" }));
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const nextConfig = configFn({ webpack: originalWebpack });
    const result = nextConfig.webpack!({} as any, { dev: true, isServer: true } as any);
    expect(originalWebpack).toHaveBeenCalled();
    expect(result).toEqual({ custom: "config" });
  });

  it("returns config directly when no existing webpack function", () => {
    const configFn = withBugwatch({ apiKey: "bw_key" });
    const nextConfig = configFn({});
    const inputConfig: any = { mode: "production" };
    const result = nextConfig.webpack!(inputConfig, { dev: false, isServer: true } as any);
    expect(result).toBe(inputConfig);
  });
});

// ── withBugwatchServerSideProps ───────────────────────────────────────────────
describe("withBugwatchServerSideProps", () => {
  it("returns handler result on success", async () => {
    const handler = vi.fn().mockResolvedValue({ props: { data: 42 } });
    const wrapped = withBugwatchServerSideProps(handler);
    const ctx = { resolvedUrl: "/page", req: { method: "GET", headers: {} } } as any;
    const result = await wrapped(ctx);
    expect(result).toEqual({ props: { data: 42 } });
  });

  it("captures Error and re-throws", async () => {
    const err = new Error("SSP error");
    const handler = vi.fn().mockRejectedValue(err);
    const wrapped = withBugwatchServerSideProps(handler);
    const ctx = { resolvedUrl: "/page", req: { method: "GET", headers: {} } } as any;
    await expect(wrapped(ctx)).rejects.toThrow(err);
    expect(vi.mocked(core.captureException)).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: expect.objectContaining({ mechanism: "getServerSideProps" }) })
    );
  });

  it("does not capture non-Error throws", async () => {
    const handler = vi.fn().mockRejectedValue("string error");
    const wrapped = withBugwatchServerSideProps(handler);
    const ctx = { resolvedUrl: "/page", req: { method: "GET", headers: {} } } as any;
    await expect(wrapped(ctx)).rejects.toBe("string error");
    expect(vi.mocked(core.captureException)).not.toHaveBeenCalled();
  });
});

// ── withBugwatchStaticProps ───────────────────────────────────────────────────
describe("withBugwatchStaticProps", () => {
  it("returns props on success", async () => {
    const handler = vi.fn().mockResolvedValue({ props: { ok: true } });
    const wrapped = withBugwatchStaticProps(handler);
    const result = await wrapped({} as any);
    expect(result).toEqual({ props: { ok: true } });
  });

  it("captures error and re-throws", async () => {
    const err = new Error("static error");
    const handler = vi.fn().mockRejectedValue(err);
    const wrapped = withBugwatchStaticProps(handler);
    await expect(wrapped({} as any)).rejects.toThrow(err);
    expect(vi.mocked(core.captureException)).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: expect.objectContaining({ mechanism: "getStaticProps" }) })
    );
  });
});

// ── withBugwatchApi ───────────────────────────────────────────────────────────
describe("withBugwatchApi", () => {
  it("calls through to the handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withBugwatchApi(handler);
    await wrapped({ method: "POST", url: "/api", headers: {} }, {});
    expect(handler).toHaveBeenCalled();
  });

  it("captures error and re-throws", async () => {
    const err = new Error("api error");
    const handler = vi.fn().mockRejectedValue(err);
    const wrapped = withBugwatchApi(handler);
    await expect(wrapped({ method: "GET", url: "/api", headers: {} }, {})).rejects.toThrow(err);
    expect(vi.mocked(core.captureException)).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: expect.objectContaining({ mechanism: "apiRoute" }) })
    );
  });

  it("filters sensitive headers from captured context", async () => {
    const err = new Error("fail");
    const handler = vi.fn().mockRejectedValue(err);
    const wrapped = withBugwatchApi(handler);
    await expect(
      wrapped({ method: "GET", url: "/api", headers: { authorization: "Bearer s", "content-type": "json" } }, {})
    ).rejects.toThrow();
    const callArgs = vi.mocked(core.captureException).mock.calls[0][1];
    expect(callArgs?.request?.headers?.authorization).toBe("[Filtered]");
    expect(callArgs?.request?.headers?.["content-type"]).toBe("json");
  });
});
