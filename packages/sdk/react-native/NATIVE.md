# Native crash capture (`BugwatchNative`)

> **NOT TESTED ON DEVICE.** The native code in `ios/` and `android/` was written and reviewed
> statically only. It has not been compiled, linked or run on a simulator, emulator or physical
> device. Verify it on both platforms before relying on it.

## How it works

1. JS calls `BugwatchNative.install()` during `init()` (synchronous, idempotent).
2. The native side installs crash handlers and, when the process dies, writes one JSON file
   (a `NativeCrash`) to app-private storage:
   - iOS: `Application Support/Bugwatch/pending-crash.json`
   - Android: `filesDir/bugwatch/pending-crash.json`
3. On the next launch JS calls `getPendingCrash()`, sends the crash as an event
   (platform `react-native`), then calls `clearPendingCrash()`.

There is one crash slot: a newer crash replaces an unreported older one.

| Platform | Captured |
| --- | --- |
| iOS | Uncaught `NSException` (chained handler); POSIX signals `SIGABRT`, `SIGBUS`, `SIGFPE`, `SIGILL`, `SIGSEGV`, `SIGSYS`, `SIGTRAP` (async-signal-safe writer, alternate stack on the main thread, previous handlers chained) |
| Android | Uncaught Java/Kotlin exceptions on any thread (chained `Thread.UncaughtExceptionHandler`); ANR heuristic (main thread blocked for 5 s, report withdrawn if the thread recovers) |

Frames are ordered innermost (crashing) frame first. They carry `function`, `module`, `filename`,
`lineno` (Android) or `address` plus the nearest symbol (iOS). Native frames have no `in_app` flag.

The module is exposed as `BugwatchNative` in both integration styles:

- Bare React Native: `BugwatchNativeModule.m` (iOS) and `BugwatchNativeModule.kt` + `BugwatchNativePackage.kt`
  (Android), autolinked by the React Native CLI (`react-native.config.js`, `BugwatchNative.podspec`).
- Expo (dev client / prebuild, no config plugin needed): `ios/expo/BugwatchNativeExpoModule.swift` and
  `android/src/expo/.../BugwatchNativeExpoModule.kt`, autolinked by Expo through
  `expo-module.config.json`. The Expo wrappers are only compiled when `expo-modules-core` is installed.
  In that case `react-native.config.js` turns off React Native CLI autolinking for this package so the
  classes are not linked twice.

Both wrappers call the same shared core (`BugwatchCrashHandler`).

## Limits

- **No symbolication of native frames.** iOS frames are raw addresses plus whatever `dladdr` knows
  (no dSYM upload); Android frames are as reported by the runtime (no ProGuard/R8 mapping upload).
  Hermes/JS frames are symbolicated separately through source maps, not by this module.
- **Not supported in Expo Go** (it cannot load custom native code). JS degrades to a no-op there and on web.
- Crashes before JS calls `init()` are not captured (install happens from JS).
- Crashes that only produce Mach exceptions without a BSD signal (e.g. some stack overflows,
  watchdog/jetsam kills, OOM) are not reported. A native ANR report cannot distinguish a stall that
  ends with the user killing the app from other blocked-main-thread cases.
- C++/Swift symbol names are not demangled.
- React Native New Architecture is supported through the legacy-module interop layer, not as a TurboModule.

## JS fatals produce a second report

A JS fatal error is rethrown by React Native as a native exception, so the native handler also records it
and the next launch reports it a second time:

- iOS: `type` starts with `RCTFatalException`
- Android: `type` is `com.facebook.react.common.JavascriptException`

The JS SDK already persists its own event for the fatal and dedupes these native reports.

## Contract (consumed by `src/native.ts`)

```ts
install(): void
getPendingCrash(): Promise<NativeCrash | null>
clearPendingCrash(): Promise<void>
getDeviceInfo(): Promise<{ model?; manufacturer?; os; osVersion; appVersion?; appBuild?; locale?; isEmulator? }>
```

## Review checklist when testing on device

- iOS: force `SIGSEGV` and an uncaught `NSException`, relaunch, confirm one report with frames.
- Android: throw from a background thread and from the main thread, relaunch, confirm the report; block the main thread for more than 5 s.
- Expo dev client and bare RN: confirm only one copy of the module is linked and `NativeModules.BugwatchNative` (or `globalThis.expo.modules.BugwatchNative`) resolves.
- Confirm a previously installed crash reporter's handler still runs (handlers are chained).
