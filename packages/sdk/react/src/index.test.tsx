import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// vi.mock factories are hoisted — use vi.hoisted() for variables referenced in them
const {
  mockCaptureException,
  mockCaptureMessage,
  mockAddBreadcrumb,
  mockSetUser,
  mockSetTag,
  mockSetExtra,
  mockInit,
  mockGetClient,
  mockGetEnvConfig,
} = vi.hoisted(() => ({
  mockCaptureException: vi.fn(() => "evt-id"),
  mockCaptureMessage: vi.fn(() => "msg-id"),
  mockAddBreadcrumb: vi.fn(),
  mockSetUser: vi.fn(),
  mockSetTag: vi.fn(),
  mockSetExtra: vi.fn(),
  mockInit: vi.fn(),
  mockGetClient: vi.fn(() => null as any),
  mockGetEnvConfig: vi.fn(() => ({}) as any),
}));

// ── Mock state ────────────────────────────────────────────────────────────────
let _mockClient: any = null;

function makeMockClient() {
  return {
    setTag: vi.fn(),
    captureException: vi.fn(() => "evt-id"),
    captureMessage: vi.fn(() => "msg-id"),
    addBreadcrumb: vi.fn(),
    setUser: vi.fn(),
    setExtra: vi.fn(),
  };
}

vi.mock("@bugwatch/core", () => ({
  init: mockInit,
  getClient: mockGetClient,
  getEnvConfig: mockGetEnvConfig,
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
  addBreadcrumb: mockAddBreadcrumb,
  setUser: mockSetUser,
  setTag: mockSetTag,
  setExtra: mockSetExtra,
  isBrowserExtensionError: vi.fn(() => false),
}));

import {
  BugwatchProvider,
  BugwatchErrorBoundary,
  useBugwatch,
  useCaptureException,
  useCaptureMessage,
  withBugwatchErrorBoundary,
} from "./index";
// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  _mockClient = null;
  vi.clearAllMocks();
  mockInit.mockImplementation(() => {
    _mockClient = makeMockClient();
    return _mockClient;
  });
  mockGetClient.mockImplementation(() => _mockClient);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── BugwatchProvider ──────────────────────────────────────────────────────────
describe("BugwatchProvider", () => {
  it("renders its children", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <span>hello world</span>
      </BugwatchProvider>
    );
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("initialises the SDK with the provided apiKey", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_react_key" }}>
        <div />
      </BugwatchProvider>
    );
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "bw_react_key" }));
  });

  it("does not initialise when no apiKey is available", () => {
    mockGetEnvConfig.mockReturnValue({});
    render(
      <BugwatchProvider>
        <div />
      </BugwatchProvider>
    );
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("reads apiKey from env config when not passed explicitly", () => {
    mockGetEnvConfig.mockReturnValue({ apiKey: "bw_env_key" });
    render(
      <BugwatchProvider>
        <div />
      </BugwatchProvider>
    );
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "bw_env_key" }));
  });
});

// ── BugwatchErrorBoundary ─────────────────────────────────────────────────────
describe("BugwatchErrorBoundary", () => {
  const errorConsoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  function ThrowingChild({ throws }: { throws: boolean }) {
    if (throws) throw new Error("render explosion");
    return <div>safe</div>;
  }

  afterEach(() => {
    errorConsoleSpy.mockClear();
  });

  it("renders children normally when no error", () => {
    render(
      <BugwatchErrorBoundary>
        <ThrowingChild throws={false} />
      </BugwatchErrorBoundary>
    );
    expect(screen.getByText("safe")).toBeTruthy();
  });

  it("renders fallback UI on error", () => {
    render(
      <BugwatchErrorBoundary>
        <ThrowingChild throws={true} />
      </BugwatchErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  });

  it("renders custom fallback JSX when provided", () => {
    render(
      <BugwatchErrorBoundary fallback={<span>custom error</span>}>
        <ThrowingChild throws={true} />
      </BugwatchErrorBoundary>
    );
    expect(screen.getByText("custom error")).toBeTruthy();
  });

  it("renders custom fallback function with reset", () => {
    render(
      <BugwatchErrorBoundary fallback={(err, reset) => <button onClick={reset}>{`Reset: ${err.message}`}</button>}>
        <ThrowingChild throws={true} />
      </BugwatchErrorBoundary>
    );
    expect(screen.getByText(/reset:/i)).toBeTruthy();
  });

  it("calls captureException when error is caught", () => {
    render(
      <BugwatchErrorBoundary>
        <ThrowingChild throws={true} />
      </BugwatchErrorBoundary>
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { mechanism: "react.errorBoundary" } })
    );
  });

  it("calls onError prop when provided", () => {
    const onError = vi.fn();
    render(
      <BugwatchErrorBoundary onError={onError}>
        <ThrowingChild throws={true} />
      </BugwatchErrorBoundary>
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.anything());
  });
});

// ── useBugwatch ───────────────────────────────────────────────────────────────
describe("useBugwatch", () => {
  it("throws when used outside BugwatchProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function Consumer() {
      useBugwatch();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow("useBugwatch must be used within a BugwatchProvider");
    consoleError.mockRestore();
  });

  it("returns context with callable captureException", () => {
    let ctx: ReturnType<typeof useBugwatch> | null = null;
    function Consumer() {
      ctx = useBugwatch();
      return null;
    }
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <Consumer />
      </BugwatchProvider>
    );
    expect(ctx).not.toBeNull();
    expect(typeof ctx!.captureException).toBe("function");
  });
});

// ── useCaptureException / useCaptureMessage ───────────────────────────────────
describe("useCaptureException", () => {
  it("returns a function that captures exceptions", () => {
    let capture: ReturnType<typeof useCaptureException> | null = null;
    function Consumer() {
      capture = useCaptureException();
      return null;
    }
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <Consumer />
      </BugwatchProvider>
    );
    const err = new Error("captured");
    capture!(err);
    expect(mockCaptureException).toHaveBeenCalledWith(err, undefined);
  });
});

describe("useCaptureMessage", () => {
  it("returns a function that captures messages", () => {
    let capture: ReturnType<typeof useCaptureMessage> | null = null;
    function Consumer() {
      capture = useCaptureMessage();
      return null;
    }
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <Consumer />
      </BugwatchProvider>
    );
    capture!("test message", "warning");
    expect(mockCaptureMessage).toHaveBeenCalledWith("test message", "warning");
  });
});

// ── withBugwatchErrorBoundary ─────────────────────────────────────────────────
describe("withBugwatchErrorBoundary", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleError.mockClear();
  });

  it("wraps the component and renders it normally", () => {
    function Hello({ name }: { name: string }) {
      return <div>Hello {name}</div>;
    }
    const Wrapped = withBugwatchErrorBoundary(Hello);
    render(<Wrapped name="world" />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("shows fallback when wrapped component throws", () => {
    function Broken() {
      throw new Error("broken!");
      return null;
    }
    const Wrapped = withBugwatchErrorBoundary(Broken, {
      fallback: <span>wrapped fallback</span>,
    });
    render(<Wrapped />);
    expect(screen.getByText("wrapped fallback")).toBeTruthy();
  });

  it("sets a displayName on the HOC", () => {
    function MyComponent() {
      return null;
    }
    const Wrapped = withBugwatchErrorBoundary(MyComponent);
    expect(Wrapped.displayName).toBe("withBugwatchErrorBoundary(MyComponent)");
  });
});

// ── BugwatchProvider — global error handlers ──────────────────────────────────
describe("BugwatchProvider global error handlers", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("sets up window.onerror after mount", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    expect(typeof window.onerror).toBe("function");
  });

  it("window.onerror captures uncaught errors", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    const err = new Error("uncaught global error");
    window.onerror!("message", "http://example.com/app.js", 10, 5, err);
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: { mechanism: "window.onerror" } })
    );
  });

  it("window.onerror skips already-captured errors", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    const err = new Error("already captured");
    (err as any).__bugwatch_captured = true;
    window.onerror!("message", "http://example.com", 1, 1, err);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("window.onerror restores previous handler on unmount", () => {
    const prevHandler = vi.fn();
    window.onerror = prevHandler;
    const { unmount } = render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    expect(window.onerror).not.toBe(prevHandler);
    unmount();
    expect(window.onerror).toBe(prevHandler);
    window.onerror = null;
  });

  it("unhandledrejection handler captures promise rejections", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    const err = new Error("unhandled promise rejection");
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: err,
    });
    window.dispatchEvent(event);
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: { mechanism: "unhandledrejection" } })
    );
  });

  it("unhandledrejection handler skips already-captured errors", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    const err = new Error("fetch-captured");
    (err as any).__bugwatch_captured = true;
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: err }));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("unhandledrejection handler wraps non-Error reasons", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: "plain string rejection",
      })
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "plain string rejection" }),
      expect.objectContaining({ tags: { mechanism: "unhandledrejection" } })
    );
  });

  it("console.error hook adds breadcrumb", () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    console.error("database connection failed");
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "console",
        level: "error",
        message: "database connection failed",
      })
    );
  });

  it("logs debug message when debug is true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(
      <BugwatchProvider options={{ apiKey: "bw_test", debug: true }}>
        <div />
      </BugwatchProvider>
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[Bugwatch]"));
    logSpy.mockRestore();
  });
});

// ── BugwatchProvider — fetch instrumentation ──────────────────────────────────
describe("BugwatchProvider fetch instrumentation", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let mockOriginalFetch: ReturnType<typeof vi.fn>;
  let savedFetch: typeof window.fetch;

  beforeEach(() => {
    savedFetch = window.fetch;
    mockOriginalFetch = vi.fn();
    window.fetch = mockOriginalFetch as unknown as typeof window.fetch;
  });

  afterEach(() => {
    window.fetch = savedFetch;
    consoleSpy.mockClear();
  });

  it("adds http breadcrumb for successful fetch", async () => {
    mockOriginalFetch.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ text: () => Promise.resolve("") }),
    });
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.example.com/users");
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "http",
        message: "GET https://api.example.com/users",
        level: "info",
        data: expect.objectContaining({ url: "https://api.example.com/users", status_code: 200 }),
      })
    );
  });

  it("captures 5xx responses as errors", async () => {
    mockOriginalFetch.mockResolvedValue({
      ok: false,
      status: 500,
      clone: () => ({ text: () => Promise.resolve("Internal Server Error") }),
    });
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.example.com/crash");
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "HttpError" }),
      expect.objectContaining({ level: "error" })
    );
  });

  it("captures 4xx responses (excluding 401/403) as warnings", async () => {
    mockOriginalFetch.mockResolvedValue({
      ok: false,
      status: 404,
      clone: () => ({ text: () => Promise.resolve("Not Found") }),
    });
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.example.com/missing");
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "HttpError" }),
      expect.objectContaining({ level: "warning" })
    );
  });

  it("does not capture 401 responses", async () => {
    mockOriginalFetch.mockResolvedValue({
      ok: false,
      status: 401,
      clone: () => ({ text: () => Promise.resolve("Unauthorized") }),
    });
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.example.com/secure");
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("does not capture 403 responses", async () => {
    mockOriginalFetch.mockResolvedValue({
      ok: false,
      status: 403,
      clone: () => ({ text: () => Promise.resolve("Forbidden") }),
    });
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.example.com/forbidden");
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("skips instrumentation for SDK endpoint URLs", async () => {
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await window.fetch("https://api.bugwatch.dev/api/v1/events");
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    expect(mockOriginalFetch).toHaveBeenCalledWith("https://api.bugwatch.dev/api/v1/events", undefined);
  });

  it("captures network errors and re-throws", async () => {
    const networkErr = new Error("Network connection refused");
    mockOriginalFetch.mockRejectedValue(networkErr);
    render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    await expect(window.fetch("https://api.example.com/data")).rejects.toThrow("Network connection refused");
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network connection refused" }),
      expect.objectContaining({ level: "error", tags: expect.objectContaining({ mechanism: "fetch" }) })
    );
  });

  it("restores original fetch on unmount", () => {
    const { unmount } = render(
      <BugwatchProvider options={{ apiKey: "bw_test" }}>
        <div />
      </BugwatchProvider>
    );
    expect(window.fetch).not.toBe(mockOriginalFetch);
    unmount();
    expect(window.fetch).toBe(mockOriginalFetch);
  });
});

// ── ErrorBoundary — location change reset ─────────────────────────────────────
describe("ErrorBoundary location change reset", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("resets error state when location-change event fires", () => {
    let shouldThrow = true;
    function DynamicThrower() {
      if (shouldThrow) throw new Error("navigation error");
      return <div>recovered after nav</div>;
    }

    const { rerender } = render(
      <BugwatchErrorBoundary>
        <DynamicThrower />
      </BugwatchErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeTruthy();

    shouldThrow = false;
    act(() => {
      window.dispatchEvent(new Event("bugwatch:location-change"));
    });

    rerender(
      <BugwatchErrorBoundary>
        <DynamicThrower />
      </BugwatchErrorBoundary>
    );

    expect(screen.getByText("recovered after nav")).toBeTruthy();
  });
});

// ── ErrorBoundary — reset button ──────────────────────────────────────────────
describe("ErrorBoundary reset button", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("clicking Try again clears the error state", () => {
    let shouldThrow = true;
    function DynamicThrower() {
      if (shouldThrow) throw new Error("reset test error");
      return <div>reset content</div>;
    }

    const { rerender } = render(
      <BugwatchErrorBoundary>
        <DynamicThrower />
      </BugwatchErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    rerender(
      <BugwatchErrorBoundary>
        <DynamicThrower />
      </BugwatchErrorBoundary>
    );

    expect(screen.getByText("reset content")).toBeTruthy();
  });
});
