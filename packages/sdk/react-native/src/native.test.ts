import { reset } from "@bugwatch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeModules } from "react-native";
import { captureNativeCrash, getNativeModule, setupNativeCrashReporting } from "./native";
import { startCapturingClient } from "./test/harness";
import type { BugwatchNativeModule, NativeCrash } from "./types";

const crash: NativeCrash = {
  timestamp: "2026-01-01T00:00:00.000Z",
  platform: "ios",
  type: "NSInvalidArgumentException",
  message: "unrecognized selector",
  frames: [
    { function: "-[Foo bar]", filename: "MyApp", address: "0x1000" },
    { function: "objc_msgSend", filename: "libobjc.A.dylib" },
  ],
  device: { model: "iPhone15,2", os: "iOS", osVersion: "17.2", appVersion: "1.2.3", appBuild: "45" },
  threadName: "main",
};

function fakeModule(pending: NativeCrash | null): BugwatchNativeModule {
  return {
    install: vi.fn(),
    getPendingCrash: vi.fn(async () => pending),
    clearPendingCrash: vi.fn(async () => {}),
    getDeviceInfo: vi.fn(async () => ({ os: "ios", osVersion: "17.2" })),
  };
}

afterEach(() => {
  reset();
  delete NativeModules.BugwatchNative;
  delete globalThis.expo;
});

describe("getNativeModule", () => {
  it("returns null when nothing is linked", () => {
    expect(getNativeModule()).toBeNull();
  });

  it("prefers the bridge module, then the Expo modules global", () => {
    const expoMod = fakeModule(null);
    globalThis.expo = { modules: { BugwatchNative: expoMod } };
    expect(getNativeModule()).toBe(expoMod);

    const bridgeMod = fakeModule(null);
    NativeModules.BugwatchNative = bridgeMod;
    expect(getNativeModule()).toBe(bridgeMod);
  });

  it("ignores objects that do not implement the contract", () => {
    NativeModules.BugwatchNative = { install() {} };
    expect(getNativeModule()).toBeNull();
  });
});

describe("captureNativeCrash", () => {
  it("builds a fatal event with native frames in extra", () => {
    const { events } = startCapturingClient();
    captureNativeCrash(crash);
    const event = events[0];
    expect(event?.level).toBe("fatal");
    expect(event?.timestamp).toBe(crash.timestamp);
    expect(event?.exception?.type).toBe("NSInvalidArgumentException");
    expect(event?.exception?.stacktrace[0]).toMatchObject({ filename: "MyApp", function: "-[Foo bar]", in_app: true });
    expect(event?.exception?.stacktrace[1]?.in_app).toBe(false);
    expect(event?.tags).toMatchObject({ mechanism: "native", handled: "false", native_platform: "ios" });
    expect(event?.extra?.native_frames).toMatchObject([{ native: true, in_app: true }, { native: true, in_app: false }]);
    expect(event?.breadcrumbs).toEqual([]);
  });
});

describe("setupNativeCrashReporting", () => {
  it("is a no-op without a native module", async () => {
    await expect(setupNativeCrashReporting(null)).resolves.toBeUndefined();
  });

  it("reports a pending crash then clears it", async () => {
    const { events } = startCapturingClient();
    const mod = fakeModule(crash);
    await setupNativeCrashReporting(mod, 10);
    expect(mod.install).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(mod.clearPendingCrash).toHaveBeenCalledOnce();
  });

  it("clears without reporting when there is no crash", async () => {
    const { events } = startCapturingClient();
    const mod = fakeModule(null);
    await setupNativeCrashReporting(mod, 10);
    expect(events).toHaveLength(0);
  });

  it.each(["RCTFatalException: Unhandled JS Exception", "com.facebook.react.common.JavascriptException"])(
    "drops JS fatals rethrown natively (%s) but clears them",
    async (type) => {
      const { events } = startCapturingClient();
      const mod = fakeModule({ ...crash, type });
      await setupNativeCrashReporting(mod, 10);
      expect(events).toHaveLength(0);
      expect(mod.clearPendingCrash).toHaveBeenCalledOnce();
    }
  );
});
