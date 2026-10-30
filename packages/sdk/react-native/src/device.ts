import type { BugwatchClient, RuntimeInfo } from "@bugwatch/core";
import { Dimensions, Platform } from "react-native";
import { getNativeModule } from "./native";
import type { NativeDeviceInfo } from "./types";

/** JS engine in use: Hermes exposes a `HermesInternal` global, JSC does not. */
export function detectRuntime(): RuntimeInfo {
  if (globalThis.HermesInternal) {
    const props = globalThis.HermesInternal.getRuntimeProperties?.() ?? {};
    return { name: "hermes", version: props["OSS Release Version"] ?? "unknown" };
  }
  return { name: "jsc", version: "unknown" };
}

/** Device facts available synchronously from React Native itself. */
export function getFallbackDeviceInfo(): NativeDeviceInfo {
  const constants = Platform.constants ?? {};
  const info: NativeDeviceInfo = {
    os: Platform.OS,
    osVersion: String(Platform.Version),
  };
  if (Platform.OS === "android") {
    if (typeof constants.Model === "string") info.model = constants.Model;
    if (typeof constants.Brand === "string") info.manufacturer = constants.Brand;
    if (typeof constants.Release === "string") info.osVersion = constants.Release;
  } else if (Platform.OS === "ios") {
    info.manufacturer = "Apple";
    if (typeof constants.osVersion === "string") info.osVersion = constants.osVersion;
    if (typeof constants.interfaceIdiom === "string") info.model = constants.interfaceIdiom;
  }
  return info;
}

/** Tag/extra context derived from device info. Tag values are strings. */
export function applyDeviceContext(client: BugwatchClient, info: NativeDeviceInfo): void {
  const tags: Record<string, string | undefined> = {
    "os.name": info.os,
    "os.version": info.osVersion,
    "device.model": info.model,
    "device.manufacturer": info.manufacturer,
    "app.version": info.appVersion,
    "app.build": info.appBuild,
    locale: info.locale,
    "device.simulator": info.isEmulator === undefined ? undefined : String(info.isEmulator),
  };
  for (const [key, value] of Object.entries(tags)) {
    if (value) client.setTag(key, value);
  }

  const { width, height, scale, fontScale } = Dimensions.get("window");
  client.setExtra("device", { ...info, screen: { width, height, scale, fontScale } });
}

/**
 * Apply fallback device info immediately, then upgrade it with the native
 * module's richer data once that resolves.
 */
export async function setupDeviceContext(client: BugwatchClient): Promise<void> {
  applyDeviceContext(client, getFallbackDeviceInfo());
  const mod = getNativeModule();
  if (!mod) return;
  try {
    applyDeviceContext(client, await mod.getDeviceInfo());
  } catch {
    // Fallback context stays in place.
  }
}
