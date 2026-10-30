package io.bugwatch.reactnative

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Modules API wrapper. Only compiled when `:expo-modules-core` is part of the host build
 * (see android/build.gradle); bare React Native uses [BugwatchNativeModule].
 */
class BugwatchNativeExpoModule : Module() {
    private val context: Context
        get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("BugwatchNative")

        Function("install") {
            BugwatchCrashHandler.install(context)
        }

        AsyncFunction("getPendingCrash") {
            BugwatchCrashHandler.readPendingCrash(context)?.let { BugwatchCrashHandler.jsonToMap(it) }
        }

        AsyncFunction("clearPendingCrash") {
            BugwatchCrashHandler.clearPendingCrash(context)
        }

        AsyncFunction("getDeviceInfo") {
            BugwatchCrashHandler.deviceInfo(context)
        }
    }
}
