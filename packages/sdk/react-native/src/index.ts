/**
 * @bugwatch/react-native
 *
 * Error monitoring for React Native (bare and Expo): JS errors, unhandled
 * rejections, native crashes, breadcrumbs, and source-mapped Hermes stacks.
 */

export { init, close, setTags } from "./init";
export { captureException } from "./errors";
export { crashedLastRun } from "./native";
export {
  BugwatchErrorBoundary,
  BugwatchProvider,
  useBugwatch,
  withBugwatchErrorBoundary,
  type BugwatchContextValue,
  type BugwatchErrorBoundaryProps,
  type BugwatchFallback,
  type BugwatchProviderProps,
} from "./components";
export {
  createNavigationIntegration,
  useNavigationBreadcrumbs,
  type NavigationContainerLike,
  type NavigationContainerRefInput,
  type NavigationIntegration,
  type NavigationIntegrationOptions,
  type NavigationRouteLike,
} from "./navigation";
export type {
  BugwatchNativeModule,
  BugwatchStorage,
  NativeCrash,
  NativeCrashFrame,
  NativeDeviceInfo,
  ReactNativeOptions,
} from "./types";

export {
  addBreadcrumb,
  captureMessage,
  flush,
  getClient,
  setExtra,
  setTag,
  setUser,
} from "@bugwatch/core";
export type {
  Breadcrumb,
  BugwatchClient,
  BugwatchOptions,
  ErrorEvent,
  ExceptionInfo,
  OfflineOptions,
  QueueStorage,
  RuntimeInfo,
  StackFrame,
  UserContext,
} from "@bugwatch/core";
