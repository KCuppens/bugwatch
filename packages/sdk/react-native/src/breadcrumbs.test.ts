import { reset } from "@bugwatch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appStateListenerCount, emitAppState } from "./test/react-native.mock";
import { setupAppStateBreadcrumbs, setupConsoleBreadcrumbs, setupNetworkBreadcrumbs } from "./breadcrumbs";
import { startCapturingClient } from "./test/harness";

afterEach(() => {
  reset();
  vi.unstubAllGlobals();
});

function crumbs(events: ReturnType<typeof startCapturingClient>["events"]) {
  return events[0]?.breadcrumbs ?? [];
}

describe("setupConsoleBreadcrumbs", () => {
  it("records console calls, forwards them, and restores on teardown", () => {
    const { client, events } = startCapturingClient();
    const original = vi.spyOn(console, "warn").mockImplementation(() => {});
    const restore = setupConsoleBreadcrumbs();

    console.warn("low battery", { secret: "x" }, new Error("bad"));
    expect(original).toHaveBeenCalledOnce();

    client.captureMessage("check");
    const crumb = crumbs(events).find((c) => c.category === "console");
    expect(crumb).toMatchObject({ level: "warning", message: "low battery [Object] Error: bad" });

    restore();
    expect(console.warn).toBe(original);
  });

  it("ignores SDK debug output", () => {
    const { client, events } = startCapturingClient();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const restore = setupConsoleBreadcrumbs();
    console.log("[Bugwatch] internal");
    client.captureMessage("check");
    expect(crumbs(events).some((c) => c.category === "console")).toBe(false);
    restore();
  });
});

describe("setupNetworkBreadcrumbs", () => {
  it("records fetch calls without the query string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));
    const { client, events } = startCapturingClient();
    const restore = setupNetworkBreadcrumbs();

    await fetch("https://example.com/api/items?token=secret", { method: "post" });
    client.captureMessage("check");

    const crumb = crumbs(events).find((c) => c.category === "fetch");
    expect(crumb).toMatchObject({
      message: "POST https://example.com/api/items [404]",
      level: "warning",
      data: { status_code: 404 },
    });
    restore();
  });

  it("does not record requests to the Bugwatch endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    const { client, events } = startCapturingClient({ endpoint: "https://ingest.example.test" });
    const restore = setupNetworkBreadcrumbs();
    await fetch("https://ingest.example.test/api/v1/events");
    client.captureMessage("check");
    expect(crumbs(events).some((c) => c.category === "fetch")).toBe(false);
    restore();
  });

  it("records failed fetches and rethrows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const { client, events } = startCapturingClient();
    const restore = setupNetworkBreadcrumbs();
    await expect(fetch("https://example.com/x")).rejects.toThrow("offline");
    client.captureMessage("check");
    expect(crumbs(events).find((c) => c.category === "fetch")).toMatchObject({ level: "error" });
    restore();
  });

  it("restores fetch on teardown", () => {
    const stub = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", stub);
    startCapturingClient();
    setupNetworkBreadcrumbs()();
    expect(globalThis.fetch).toBe(stub);
  });

  it("does not double-record XHRs opened by fetch", async () => {
    const listeners: Array<() => void> = [];
    class FakeXhr {
      status = 200;
      open(_method: string, _url: string): void {}
      send(): void {
        for (const l of listeners) l();
      }
      addEventListener(_type: string, listener: () => void): void {
        listeners.push(listener);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    // Like RN's polyfill: fetch opens an XHR synchronously.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const xhr = new FakeXhr();
        xhr.open("GET", "https://example.com/a");
        xhr.send();
        return { status: 200 };
      })
    );
    const { client, events } = startCapturingClient();
    const restore = setupNetworkBreadcrumbs();

    await fetch("https://example.com/a");
    const direct = new FakeXhr();
    direct.open("GET", "https://example.com/b?x=1");
    direct.send();

    client.captureMessage("check");
    const categories = crumbs(events).map((c) => `${c.category}:${c.message}`);
    expect(categories).toEqual(["fetch:GET https://example.com/a [200]", "xhr:GET https://example.com/b [200]"]);
    restore();
  });
});

describe("setupAppStateBreadcrumbs", () => {
  it("records transitions, flushes on background, and unsubscribes", () => {
    const { client, events } = startCapturingClient();
    const flush = vi.spyOn(client, "flush").mockResolvedValue(undefined);
    const before = appStateListenerCount();
    const teardown = setupAppStateBreadcrumbs();
    expect(appStateListenerCount()).toBe(before + 1);

    emitAppState("background");
    expect(flush).toHaveBeenCalledOnce();
    client.captureMessage("check");
    expect(crumbs(events).find((c) => c.category === "app.lifecycle")?.message).toBe("App state: background");

    teardown();
    expect(appStateListenerCount()).toBe(before);
  });
});
