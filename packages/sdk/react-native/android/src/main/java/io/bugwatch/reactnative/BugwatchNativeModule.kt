package io.bugwatch.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Classic React Native module. JS name: NativeModules.BugwatchNative */
class BugwatchNativeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun install() {
        try {
            BugwatchCrashHandler.install(reactContext.applicationContext)
        } catch (ignored: Throwable) {
            // Crash capture is best effort; never break app start.
        }
    }

    @ReactMethod
    fun getPendingCrash(promise: Promise) {
        try {
            val crash = BugwatchCrashHandler.readPendingCrash(reactContext.applicationContext)
            val result: Any? =
                if (crash == null) null else Arguments.makeNativeMap(BugwatchCrashHandler.jsonToMap(crash))
            promise.resolve(result)
        } catch (e: Throwable) {
            promise.reject("E_BUGWATCH_NATIVE", e.message, e)
        }
    }

    @ReactMethod
    fun clearPendingCrash(promise: Promise) {
        try {
            BugwatchCrashHandler.clearPendingCrash(reactContext.applicationContext)
            promise.resolve(null)
        } catch (e: Throwable) {
            promise.reject("E_BUGWATCH_NATIVE", e.message, e)
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            promise.resolve(Arguments.makeNativeMap(BugwatchCrashHandler.deviceInfo(reactContext.applicationContext)))
        } catch (e: Throwable) {
            promise.reject("E_BUGWATCH_NATIVE", e.message, e)
        }
    }

    companion object {
        const val NAME = "BugwatchNative"
    }
}
