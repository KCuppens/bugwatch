import { getClient } from "@bugwatch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeModules } from "react-native";
import { close, init, setTags } from "./init";
import type { BugwatchStorage } from "./types";

const noopHandlers = {
  captureConsoleBreadcrumbs: false,
  captureNetworkBreadcrumbs: false,
  captureAppStateBreadcrumbs: false,
  captureGlobalErrors: false,
  captureUnhandledRejections: false,
};

afterEach(async () => {
  await close();
  delete NativeModules.BugwatchNative;
});

describe("init", () => {
  it("tags dist, framework and runtime, and reports the react-native platform", () => {
    const events: Array<{ platform: string; tags?: Record<string, string>; release?: string }> = [];
    init({
      apiKey: "bw_test_key",
      release: "1.0.0",
      dist: "42",
      enableNativeCrashes: false,
      ...noopHandlers,
      beforeSend: (event) => {
        events.push(event);
        return null;
      },
    });
    globalThis.HermesInternal = undefined;
    getClient()?.captureMessage("hello");
    expect(events[0]).toMatchObject({ release: "1.0.0", tags: { dist: "42", framework: "react-native" } });
  });

  it("returns the existing client when called twice", () => {
    const first = init({ apiKey: "bw_test_key", enableNativeCrashes: false, ...noopHandlers });
    expect(init({ apiKey: "bw_test_key", enableNativeCrashes: false, ...noopHandlers })).toBe(first);
  });

  it("persists the offline queue through the storage adapter", async () => {
    const data = new Map<string, string>();
    const storage: BugwatchStorage = {
      getItem: async (k) => data.get(k) ?? null,
      setItem: vi.fn(async (k, v) => void data.set(k, v)),
      removeItem: async (k) => void data.delete(k),
    };
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const client = init({ apiKey: "bw_test_key", storage, enableNativeCrashes: false, ...noopHandlers });
    client.captureMessage("queued while offline");
    await client.flush();
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("installs the native crash handler unless disabled", async () => {
    const install = vi.fn();
    NativeModules.BugwatchNative = {
      install,
      getPendingCrash: async () => null,
      clearPendingCrash: async () => {},
      getDeviceInfo: async () => ({ os: "android", osVersion: "14" }),
    };
    init({ apiKey: "bw_test_key", ...noopHandlers });
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
  });

  it("does not touch the native module when enableNativeCrashes is false", async () => {
    const install = vi.fn();
    NativeModules.BugwatchNative = {
      install,
      getPendingCrash: async () => null,
      clearPendingCrash: async () => {},
      getDeviceInfo: async () => ({ os: "android", osVersion: "14" }),
    };
    init({ apiKey: "bw_test_key", enableNativeCrashes: false, ...noopHandlers });
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(install).not.toHaveBeenCalled();
  });
});

describe("setTags", () => {
  it("sets several tags on the client", () => {
    const events: Array<{ tags?: Record<string, string> }> = [];
    init({
      apiKey: "bw_test_key",
      enableNativeCrashes: false,
      ...noopHandlers,
      beforeSend: (event) => {
        events.push(event);
        return null;
      },
    });
    setTags({ a: "1", b: "2" });
    getClient()?.captureMessage("check");
    expect(events[0]?.tags).toMatchObject({ a: "1", b: "2" });
  });
});
