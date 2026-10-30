import { reset } from "@bugwatch/core";
import type { ErrorInfo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugwatchErrorBoundary } from "./components";
import { startCapturingClient } from "./test/harness";

afterEach(() => reset());

const errorInfo: ErrorInfo = { componentStack: "\n    at Broken" };

describe("BugwatchErrorBoundary", () => {
  it("renders children until an error is caught", () => {
    const boundary = new BugwatchErrorBoundary({ children: "child" });
    expect(boundary.render()).toBe("child");
  });

  it("derives error state and reports the error with the component stack", () => {
    const { events } = startCapturingClient();
    const onError = vi.fn();
    const boundary = new BugwatchErrorBoundary({ children: "child", onError });
    const error = new Error("render failed");

    expect(BugwatchErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
    boundary.componentDidCatch(error, errorInfo);

    expect(events[0]?.exception?.value).toBe("render failed");
    expect(events[0]?.tags).toMatchObject({ mechanism: "react.errorBoundary" });
    expect(events[0]?.extra).toMatchObject({ componentStack: errorInfo.componentStack });
    expect(onError).toHaveBeenCalledWith(error, errorInfo);
  });

  it("renders a custom fallback, passing the error and reset", () => {
    const error = new Error("x");
    const fallback = vi.fn(() => "fallback");
    const boundary = new BugwatchErrorBoundary({ children: "child", fallback });
    boundary.state = { error };
    expect(boundary.render()).toBe("fallback");
    expect(fallback).toHaveBeenCalledWith(error, boundary.reset);
  });

  it("renders a static fallback node", () => {
    const boundary = new BugwatchErrorBoundary({ children: "child", fallback: "static" });
    boundary.state = { error: new Error("x") };
    expect(boundary.render()).toBe("static");
  });

  it("renders the default fallback when none is given", () => {
    const boundary = new BugwatchErrorBoundary({ children: "child" });
    boundary.state = { error: new Error("x") };
    expect(boundary.render()).toMatchObject({ props: { accessibilityRole: "alert" } });
  });
});
