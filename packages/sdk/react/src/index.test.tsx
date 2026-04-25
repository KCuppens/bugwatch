import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

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
