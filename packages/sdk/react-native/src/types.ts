import type { BugwatchOptions } from "@bugwatch/core";

/**
 * Async key-value storage used to persist the offline event queue.
 * Compatible with `@react-native-async-storage/async-storage` and thin
 * wrappers around `react-native-mmkv`.
 */
export interface BugwatchStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ReactNativeOptions extends BugwatchOptions {
  /**
   * Persistent storage for the offline queue. Without it, unsent events are
   * kept in memory only and are lost when the app process exits.
   */
  storage?: BugwatchStorage;
  /**
   * Capture native (Objective-C / Swift / Java / Kotlin / signal) crashes.
   * They are persisted on disk by the native module and reported on the next
   * launch. No-op when the native module is not linked (Expo Go, web).
   * Default: true.
   */
  enableNativeCrashes?: boolean;
  /**
   * Distribution identifier (e.g. build number). Sent as the `dist` tag and,
   * together with `release`, selects the uploaded source map.
   */
  dist?: string;
  /** Install the global JS error handler (`ErrorUtils`). Default: true. */
  captureGlobalErrors?: boolean;
  /** Capture unhandled promise rejections. Default: true. */
  captureUnhandledRejections?: boolean;
  /** Record console calls as breadcrumbs. Default: true. */
  captureConsoleBreadcrumbs?: boolean;
  /** Record fetch / XMLHttpRequest calls as breadcrumbs. Default: true. */
  captureNetworkBreadcrumbs?: boolean;
  /** Record app foreground/background transitions as breadcrumbs. Default: true. */
  captureAppStateBreadcrumbs?: boolean;
  /**
   * Maximum time (ms) to wait for pending events to be sent before handing a
   * fatal error back to the default React Native handler. Default: 2000.
   */
  fatalFlushTimeoutMs?: number;
}

/** Frame reported by the native crash handler. */
export interface NativeCrashFrame {
  function?: string;
  filename?: string;
  module?: string;
  lineno?: number;
  address?: string;
}

/** Crash persisted by the native module and delivered on the next launch. */
export interface NativeCrash {
  /** ISO-8601 time of the crash */
  timestamp: string;
  platform: "ios" | "android";
  /** e.g. NSException, SIGSEGV, java.lang.RuntimeException, ANR */
  type: string;
  message: string;
  frames: NativeCrashFrame[];
  device: {
    model?: string;
    os?: string;
    osVersion?: string;
    appVersion?: string;
    appBuild?: string;
  };
  threadName?: string;
}

export interface NativeDeviceInfo {
  model?: string;
  manufacturer?: string;
  os: string;
  osVersion: string;
  appVersion?: string;
  appBuild?: string;
  locale?: string;
  isEmulator?: boolean;
}

/** Shape of the `BugwatchNative` native module. */
export interface BugwatchNativeModule {
  install(): void;
  getPendingCrash(): Promise<NativeCrash | null>;
  clearPendingCrash(): Promise<void>;
  getDeviceInfo(): Promise<NativeDeviceInfo>;
}
