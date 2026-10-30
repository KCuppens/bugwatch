# @bugwatch/react-native

Bugwatch error monitoring for React Native, bare or Expo (dev client / prebuild).

- Global JS errors (fatal and non-fatal) and unhandled promise rejections (Hermes)
- Native crash capture (iOS and Android), reported on the next launch
- Breadcrumbs: console, `fetch` / `XMLHttpRequest`, app state, React Navigation
- `BugwatchErrorBoundary` / `BugwatchProvider`
- Offline queue with a pluggable `storage` adapter
- Source-mapped Hermes stack traces

The JavaScript part needs no Expo config plugin. The native module is autolinked in bare React Native and is an Expo module, so `npx expo prebuild` / a dev client picks it up. In **Expo Go** and on web the native module is absent and the SDK silently skips native crash capture and uses fallback device info.

## Install

```bash
npm install @bugwatch/react-native
# bare React Native (iOS)
cd ios && pod install
```

## Setup

Initialize before anything renders, so errors thrown during startup are captured:

```tsx
// index.js
import { init, BugwatchErrorBoundary } from "@bugwatch/react-native";

init({
  apiKey: "bw_live_xxx",
  release: "1.4.0",     // must match the release you upload source maps for
  dist: "42",           // build number; part of the source-map key
  environment: "production",
});
```

```tsx
export default function App() {
  return (
    <BugwatchErrorBoundary fallback={(error, reset) => <MyErrorScreen error={error} onRetry={reset} />}>
      <Root />
    </BugwatchErrorBoundary>
  );
}
```

`BugwatchProvider` initializes (once) from `options` and wraps the tree in the same boundary; `useBugwatch()` exposes the API to components. Exported API: `init`, `close`, `captureException`, `captureMessage`, `addBreadcrumb`, `setUser`, `setTag`, `setTags`, `setExtra`, `flush`, `getClient`.

### Options

All core options (`apiKey`, `release`, `environment`, `beforeSend`, `sanitize`, ...) plus:

| Option | Default | |
|---|---|---|
| `storage` | memory | `{ getItem, setItem, removeItem }` (async). Persists the offline queue across launches. |
| `dist` | - | Build identifier, sent as the `dist` tag. |
| `enableNativeCrashes` | `true` | Install the native crash handler and report the previous launch's crash. |
| `captureGlobalErrors` | `true` | Hook `ErrorUtils`. Fatal errors are flushed (up to `fatalFlushTimeoutMs`, default 2000) before the previous handler runs. |
| `captureUnhandledRejections` | `true` | Hermes only. |
| `captureConsoleBreadcrumbs` / `captureNetworkBreadcrumbs` / `captureAppStateBreadcrumbs` | `true` | |

### Offline storage

Any async key-value store works. Without `storage`, events that fail to send are retried from memory only.

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
init({ apiKey, storage: AsyncStorage });
```

```ts
import { MMKV } from "react-native-mmkv";
const mmkv = new MMKV();
init({
  apiKey,
  storage: {
    getItem: async (k) => mmkv.getString(k) ?? null,
    setItem: async (k, v) => mmkv.set(k, v),
    removeItem: async (k) => mmkv.delete(k),
  },
});
```

### React Navigation

```tsx
import { createNavigationIntegration } from "@bugwatch/react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";

const navigationRef = createNavigationContainerRef();
const navigation = createNavigationIntegration(); // { includeParams: true } to attach route params

<NavigationContainer ref={navigationRef} onReady={() => navigation.registerNavigationContainer(navigationRef)} />
```

Or with a hook inside a component: `useNavigationBreadcrumbs(navigationRef)`. Each screen change adds a `navigation` breadcrumb and updates the `route` tag. Params are excluded by default.

## Source maps

Release builds report positions in the minified Hermes bundle; frames are sent as `app:///<bundle>` (for example `app:///index.android.bundle`). Upload the matching map so the server can symbolicate them. The key is `release` + `dist` + bundle name, so use the same values as in `init`.

```bash
# React Native: generate the map while bundling
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output android-release/index.android.bundle --sourcemap-output android-release/index.android.bundle.map

bugwatch sourcemaps upload --release 1.4.0 --dist 42 --bundle index.android.bundle android-release/index.android.bundle.map
```

For Hermes, upload the **composed** map (the one produced by `hermesc` + `compose-source-maps.js`, which Gradle / Xcode release builds emit alongside the bundle). iOS bundles are named `main.jsbundle`. Events without a matching map keep their original frames.

## Native crashes

A native crash (signal, uncaught `NSException`, uncaught JVM exception, ANR) is written to disk by the crash handler and sent as a `fatal` event on the next launch, with raw native frames in `extra.native_frames` (no dSYM / ProGuard symbolication). JS fatals are already reported by the JS handler, so the duplicate native record of a rethrown JS error is discarded. See [NATIVE.md](./NATIVE.md) for the native module internals.

`await crashedLastRun()` resolves `true` when the previous launch ended in a crash (including a JS fatal React Native rethrew natively), `false` after a clean exit, and `null` when that cannot be known (native module absent, `init` not called, `enableNativeCrashes: false`, or the check failed). It settles once `init`'s native check has run, so call it after `init`.

> **The native iOS/Android code has not been run on a device or emulator.** It was written and reviewed statically only. Test native crash capture in your own build before relying on it.
