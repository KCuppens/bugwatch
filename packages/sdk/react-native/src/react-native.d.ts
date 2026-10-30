// Minimal ambient surface of `react-native` used by the SDK. react-native is a
// peer dependency; declaring only what we touch keeps the SDK buildable
// without the (very large) real package and avoids coupling to its typings.
declare module "react-native" {
  import type { ComponentType, ReactNode } from "react";

  export const Platform: {
    OS: string;
    Version: string | number;
    constants?: Record<string, unknown>;
  };

  export interface ScaledSize {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  }

  export const Dimensions: {
    get(dim: "window" | "screen"): ScaledSize;
  };

  export const AppState: {
    currentState: string;
    addEventListener(type: "change", listener: (state: string) => void): { remove(): void } | void;
  };

  export const NativeModules: Record<string, unknown>;

  interface ViewLikeProps {
    style?: unknown;
    children?: ReactNode;
    accessibilityRole?: string;
    onPress?: () => void;
  }

  export const View: ComponentType<ViewLikeProps>;
  export const Text: ComponentType<ViewLikeProps>;
  export const Pressable: ComponentType<ViewLikeProps>;
}
