// Globals injected by the React Native / Expo runtime. Declared (not imported)
// because they only exist on-device, and may be absent.

interface RNErrorUtils {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

interface RNPromiseRejectionTrackerOptions {
  allRejections?: boolean;
  onUnhandled?: (id: number, rejection: unknown) => void;
  onHandled?: (id: number) => void;
}

interface RNHermesInternal {
  getRuntimeProperties?: () => Record<string, string>;
  hasPromise?: () => boolean;
  enablePromiseRejectionTracker?: (options: RNPromiseRejectionTrackerOptions) => void;
}

interface RNExpoGlobal {
  modules?: Record<string, unknown>;
}

declare var ErrorUtils: RNErrorUtils | undefined;
declare var HermesInternal: RNHermesInternal | undefined;
declare var expo: RNExpoGlobal | undefined;
