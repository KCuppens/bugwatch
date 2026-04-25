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

import { init, withBugwatchServerSideProps, withBugwatchStaticProps, withBugwatchApi } from "./index";
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
