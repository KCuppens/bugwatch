import { reset } from "@bugwatch/core";
import { afterEach, describe, expect, it } from "vitest";
import { createNavigationIntegration, type NavigationRouteLike } from "./navigation";
import { startCapturingClient } from "./test/harness";

afterEach(() => reset());

function fakeContainer(initial?: NavigationRouteLike) {
  let route = initial;
  const listeners = new Set<() => void>();
  return {
    addListener: (_type: "state", listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentRoute: () => route,
    navigate(next: NavigationRouteLike) {
      route = next;
      for (const l of [...listeners]) l();
    },
    listenerCount: () => listeners.size,
  };
}

describe("createNavigationIntegration", () => {
  it("adds a breadcrumb per route change and tags the current route", () => {
    const { client, events } = startCapturingClient();
    const container = fakeContainer({ name: "Home" });
    createNavigationIntegration().registerNavigationContainer(container);

    container.navigate({ name: "Profile", params: { userId: "42" } });
    container.navigate({ name: "Profile", params: { userId: "43" } });
    client.captureMessage("check");

    const nav = events[0]?.breadcrumbs?.filter((c) => c.category === "navigation");
    expect(nav).toHaveLength(1);
    expect(nav?.[0]).toMatchObject({ message: "Home -> Profile", data: { from: "Home", to: "Profile" } });
    expect(nav?.[0]?.data).not.toHaveProperty("params");
    expect(events[0]?.tags).toMatchObject({ route: "Profile" });
  });

  it("includes params only when asked", () => {
    const { client, events } = startCapturingClient();
    const container = fakeContainer({ name: "Home" });
    createNavigationIntegration({ includeParams: true }).registerNavigationContainer(container);
    container.navigate({ name: "Profile", params: { userId: "42" } });
    client.captureMessage("check");
    expect(events[0]?.breadcrumbs?.at(-1)?.data).toMatchObject({ params: { userId: "42" } });
  });

  it("accepts a ref object, and stops on unsubscribe", () => {
    startCapturingClient();
    const container = fakeContainer({ name: "Home" });
    const stop = createNavigationIntegration().registerNavigationContainer({ current: container });
    expect(container.listenerCount()).toBe(1);
    stop();
    expect(container.listenerCount()).toBe(0);
  });

  it("is a no-op for an unmounted ref", () => {
    const stop = createNavigationIntegration().registerNavigationContainer({ current: null });
    expect(() => stop()).not.toThrow();
  });
});
