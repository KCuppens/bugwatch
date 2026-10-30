import { reset } from "@bugwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureException, setupGlobalErrorHandler, setupUnhandledRejectionHandler, toError } from "./errors";
import { startCapturingClient } from "./test/harness";

type Handler = (error: unknown, isFatal?: boolean) => void;

let installed: Handler | undefined;
const previous = vi.fn();

beforeEach(() => {
  installed = undefined;
  previous.mockReset();
  globalThis.ErrorUtils = {
    getGlobalHandler: () => installed ?? previous,
    setGlobalHandler: (handler: Handler) => {
      installed = handler;
    },
  };
});

afterEach(() => {
  reset();
  delete globalThis.ErrorUtils;
  delete globalThis.HermesInternal;
  vi.useRealTimers();
});

describe("toError", () => {
  it("wraps non-errors", () => {
    expect(toError("oops").message).toBe("oops");
    expect(toError({ a: 1 }).message).toContain('{"a":1}');
    const err = new Error("x");
    expect(toError(err)).toBe(err);
  });
});

describe("captureException", () => {
  it("parses Hermes stacks into app:/// frames", () => {
    const { events } = startCapturingClient();
    const err = new Error("boom");
    err.stack = "Error: boom\n    at press (address at /data/files/index.android.bundle:1:99)";
    captureException(err);
    expect(events[0]?.exception?.stacktrace[0]).toMatchObject({
      filename: "app:///index.android.bundle",
      lineno: 1,
      colno: 99,
    });
  });
});

describe("setupGlobalErrorHandler", () => {
  it("captures non-fatal errors and calls the previous handler immediately", () => {
    const { events } = startCapturingClient();
    setupGlobalErrorHandler(50);
    installed?.(new Error("soft"), false);
    expect(events[0]?.level).toBe("error");
    expect(events[0]?.tags).toMatchObject({ mechanism: "onerror", handled: "false" });
    expect(previous).toHaveBeenCalledOnce();
  });

  it("flushes before handing a fatal error to the previous handler", async () => {
    const { client, events } = startCapturingClient();
    let flushed = false;
    vi.spyOn(client, "flush").mockImplementation(async () => {
      flushed = true;
      return true;
    });
    setupGlobalErrorHandler(1000);
    const err = new Error("fatal");
    installed?.(err, true);
    expect(events[0]?.level).toBe("fatal");
    expect(previous).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(previous).toHaveBeenCalledWith(err, true));
    expect(flushed).toBe(true);
  });

  it("does not wait forever when flush hangs", async () => {
    vi.useFakeTimers();
    const { client } = startCapturingClient();
    vi.spyOn(client, "flush").mockImplementation(() => new Promise(() => {}));
    setupGlobalErrorHandler(300);
    installed?.(new Error("fatal"), true);
    await vi.advanceTimersByTimeAsync(301);
    expect(previous).toHaveBeenCalledOnce();
  });

  it("restores the previous handler on teardown", () => {
    startCapturingClient();
    const teardown = setupGlobalErrorHandler(50);
    expect(installed).toBeDefined();
    teardown();
    expect(installed).toBe(previous);
  });

  it("is a no-op without ErrorUtils", () => {
    delete globalThis.ErrorUtils;
    expect(() => setupGlobalErrorHandler(50)()).not.toThrow();
  });
});

describe("setupUnhandledRejectionHandler", () => {
  it("captures rejections reported by the Hermes tracker", () => {
    const { events } = startCapturingClient();
    let tracker: { onUnhandled?: (id: number, reason: unknown) => void } = {};
    globalThis.HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (opts) => {
        tracker = opts;
      },
    };
    setupUnhandledRejectionHandler();
    tracker.onUnhandled?.(1, "nope");
    expect(events[0]?.exception?.value).toBe("nope");
    expect(events[0]?.tags).toMatchObject({ mechanism: "onunhandledrejection" });
  });
});
