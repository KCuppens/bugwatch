import { createElement, type ReactNode } from "react";

/** Controllable stand-in for `react-native`, aliased in vitest.config.ts. */

export const Platform: {
  OS: string;
  Version: string | number;
  constants: Record<string, unknown>;
} = {
  OS: "android",
  Version: 34,
  constants: { Model: "Pixel 8", Brand: "google", Release: "14" },
};

export const Dimensions = {
  get: (_dim: "window" | "screen") => ({ width: 412, height: 915, scale: 2.75, fontScale: 1 }),
};

type StateListener = (state: string) => void;
const stateListeners = new Set<StateListener>();

export const AppState = {
  currentState: "active",
  addEventListener(_type: "change", listener: StateListener) {
    stateListeners.add(listener);
    return { remove: () => stateListeners.delete(listener) };
  },
};

export function emitAppState(state: string): void {
  AppState.currentState = state;
  for (const l of [...stateListeners]) l(state);
}

export function appStateListenerCount(): number {
  return stateListeners.size;
}

export const NativeModules: Record<string, unknown> = {};

type Props = { children?: ReactNode; onPress?: () => void; accessibilityRole?: string; style?: unknown };
export const View = (props: Props) => createElement("View", props, props.children);
export const Text = (props: Props) => createElement("Text", props, props.children);
export const Pressable = (props: Props) => createElement("Pressable", props, props.children);
