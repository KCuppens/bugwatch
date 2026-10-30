// Expo Modules API wrapper. Only compiled into the pod when `expo-modules-core` is present in the
// host project (see BugwatchNative.podspec); bare React Native uses BugwatchNativeModule.m.
#if canImport(ExpoModulesCore)
import ExpoModulesCore

public class BugwatchNativeExpoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BugwatchNative")

    Function("install") {
      BugwatchCrashHandler.install()
    }

    AsyncFunction("getPendingCrash") { () -> [String: Any]? in
      return BugwatchCrashHandler.pendingCrash()
    }

    AsyncFunction("clearPendingCrash") { () -> Void in
      BugwatchCrashHandler.clearPendingCrash()
    }

    AsyncFunction("getDeviceInfo") { () -> [String: Any] in
      return BugwatchCrashHandler.deviceInfo()
    }
  }
}
#endif
