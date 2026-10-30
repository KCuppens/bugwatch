import { close as coreClose, getClient, init as coreInit, type BugwatchClient } from "@bugwatch/core";
import { setupAppStateBreadcrumbs, setupConsoleBreadcrumbs, setupNetworkBreadcrumbs } from "./breadcrumbs";
import { detectRuntime, setupDeviceContext } from "./device";
import { setupGlobalErrorHandler, setupUnhandledRejectionHandler } from "./errors";
import { setupNativeCrashReporting } from "./native";
import type { ReactNativeOptions } from "./types";

const DEFAULT_FATAL_FLUSH_TIMEOUT_MS = 2000;

let teardowns: Array<() => void> = [];
let initialized = false;

/**
 * Initialize Bugwatch for React Native (bare or Expo).
 *
 * Installs the global JS error handler, unhandled rejection tracking, console /
 * network / app-state breadcrumbs, device context, and (when the native module
 * is linked) native crash reporting. Calling it again returns the existing
 * client without installing anything twice.
 */
export function init(options: ReactNativeOptions): BugwatchClient {
  const existing = initialized ? getClient() : null;
  if (existing) return existing;

  const {
    storage,
    enableNativeCrashes = true,
    dist,
    captureGlobalErrors = true,
    captureUnhandledRejections = true,
    captureConsoleBreadcrumbs = true,
    captureNetworkBreadcrumbs = true,
    captureAppStateBreadcrumbs = true,
    fatalFlushTimeoutMs = DEFAULT_FATAL_FLUSH_TIMEOUT_MS,
    ...coreOptions
  } = options;

  const client = coreInit({
    ...coreOptions,
    runtime: coreOptions.runtime ?? detectRuntime(),
    tags: { ...(dist && { dist }), ...coreOptions.tags },
    // Without a storage adapter the queue is memory-only, which still retries
    // events that fail while the device is offline.
    offline: { enabled: true, storage, ...coreOptions.offline },
  });
  initialized = true;

  client.setTag("framework", "react-native");
  void setupDeviceContext(client);

  if (captureGlobalErrors) teardowns.push(setupGlobalErrorHandler(fatalFlushTimeoutMs));
  if (captureUnhandledRejections) teardowns.push(setupUnhandledRejectionHandler());
  if (captureConsoleBreadcrumbs) teardowns.push(setupConsoleBreadcrumbs());
  if (captureNetworkBreadcrumbs) teardowns.push(setupNetworkBreadcrumbs());
  if (captureAppStateBreadcrumbs) teardowns.push(setupAppStateBreadcrumbs());

  if (enableNativeCrashes) void setupNativeCrashReporting();

  if (coreOptions.debug) {
    console.log("[Bugwatch] React Native SDK initialized");
  }
  return client;
}

/** Remove every handler installed by {@link init}, flush, and shut the client down. */
export async function close(): Promise<void> {
  for (const teardown of teardowns.reverse()) teardown();
  teardowns = [];
  initialized = false;
  await coreClose();
}

/** Set several tags at once. */
export function setTags(tags: Record<string, string>): void {
  const client = getClient();
  if (!client) return;
  for (const [key, value] of Object.entries(tags)) client.setTag(key, value);
}
