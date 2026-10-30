import { captureException, getClient, type ExceptionInfo, type StackFrame } from "@bugwatch/core";
import { NativeModules } from "react-native";
import type { BugwatchNativeModule, NativeCrash, NativeCrashFrame } from "./types";

const DEFAULT_CRASH_FLUSH_TIMEOUT_MS = 5000;

/**
 * Native crashes that merely re-report a JS fatal rethrown by React Native.
 * The JS global handler already reported the original error.
 */
const JS_FATAL_TYPES = ["RCTFatalException", "com.facebook.react.common.JavascriptException"];

/** Frames from these images / packages are system or framework code. */
const SYSTEM_FRAME_PREFIXES = [
  "/usr/lib",
  "/system/",
  "/apex/",
  "/vendor/",
  "libsystem",
  "libobjc",
  "libdispatch",
  "libc++",
  "libc.so",
  "libart",
  "libhwui",
  "libandroid",
  "libbase",
  "CoreFoundation",
  "Foundation",
  "UIKit",
  "QuartzCore",
  "GraphicsServices",
  "CoreGraphics",
  "libswift",
  "java.",
  "javax.",
  "android.",
  "androidx.",
  "com.android.",
  "dalvik.",
  "kotlin.",
  "kotlinx.",
  "com.facebook.react.",
  "com.facebook.jni.",
  "com.facebook.hermes.",
  "React",
  "hermes",
  "libhermes",
  "libreactnative",
  "libjsc",
];

function isNativeModule(candidate: unknown): candidate is BugwatchNativeModule {
  if (typeof candidate !== "object" || candidate === null) return false;
  return (
    "install" in candidate &&
    typeof candidate.install === "function" &&
    "getPendingCrash" in candidate &&
    typeof candidate.getPendingCrash === "function" &&
    "clearPendingCrash" in candidate &&
    typeof candidate.clearPendingCrash === "function" &&
    "getDeviceInfo" in candidate &&
    typeof candidate.getDeviceInfo === "function"
  );
}

/**
 * Resolve the `BugwatchNative` module: the React Native bridge first, then
 * the Expo modules global. Returns null when it is not linked (Expo Go, web,
 * tests) so every caller can degrade to a no-op.
 */
export function getNativeModule(): BugwatchNativeModule | null {
  const bridge = NativeModules?.BugwatchNative;
  if (isNativeModule(bridge)) return bridge;
  const expoModule = globalThis.expo?.modules?.BugwatchNative;
  return isNativeModule(expoModule) ? expoModule : null;
}

function isInAppFrame(frame: NativeCrashFrame): boolean {
  const name = frame.module ?? frame.filename ?? "";
  if (!name) return false;
  return !SYSTEM_FRAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function toStackFrame(frame: NativeCrashFrame): StackFrame {
  return {
    filename: frame.filename ?? frame.module ?? "<native>",
    function: frame.function ?? frame.address ?? "<unknown>",
    lineno: frame.lineno ?? 0,
    colno: 0,
    in_app: isInAppFrame(frame),
  };
}

/** Convert a persisted native crash into a fatal event and send it. */
export function captureNativeCrash(crash: NativeCrash): string {
  const stacktrace = crash.frames.map(toStackFrame);
  const exception: ExceptionInfo = { type: crash.type, value: crash.message, stacktrace };
  const error = new Error(crash.message);
  error.name = crash.type;

  const tags: Record<string, string> = {
    mechanism: "native",
    handled: "false",
    native_platform: crash.platform,
  };
  if (crash.device.os) tags["os.name"] = crash.device.os;
  if (crash.device.osVersion) tags["os.version"] = crash.device.osVersion;
  if (crash.device.model) tags["device.model"] = crash.device.model;
  if (crash.device.appVersion) tags["crash.app_version"] = crash.device.appVersion;
  if (crash.device.appBuild) tags["crash.app_build"] = crash.device.appBuild;

  return captureException(error, {
    timestamp: crash.timestamp,
    level: "fatal",
    message: `${crash.type}: ${crash.message}`,
    exception,
    // Breadcrumbs of the current session do not describe the crashed one.
    breadcrumbs: [],
    tags,
    extra: {
      native_frames: crash.frames.map((frame, i) => ({
        ...frame,
        in_app: stacktrace[i]?.in_app ?? false,
        native: true,
      })),
      native_thread: crash.threadName,
      native_device: crash.device,
    },
  });
}

/**
 * Install the native crash handler and report a crash left over from the
 * previous run, if any. The pending crash is cleared only after the event has
 * been handed to the transport and flushed, so a crash is not lost when the
 * app is killed mid-send.
 */
export async function setupNativeCrashReporting(
  mod: BugwatchNativeModule | null = getNativeModule(),
  flushTimeoutMs = DEFAULT_CRASH_FLUSH_TIMEOUT_MS
): Promise<void> {
  if (!mod) return;
  try {
    mod.install();
    const crash = await mod.getPendingCrash();
    if (!crash) return;

    if (!JS_FATAL_TYPES.some((type) => crash.type.startsWith(type))) {
      captureNativeCrash(crash);
      await Promise.race([
        getClient()?.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, flushTimeoutMs)),
      ]);
    }
    await mod.clearPendingCrash();
  } catch (err) {
    if (getClient()?.getOptions().debug) {
      console.warn("[Bugwatch] Native crash reporting failed:", err);
    }
  }
}
