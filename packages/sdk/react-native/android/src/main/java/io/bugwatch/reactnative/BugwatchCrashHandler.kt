package io.bugwatch.reactnative

import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.system.exitProcess

/**
 * Native crash capture for Bugwatch (Android).
 *
 * - Chains a [Thread.UncaughtExceptionHandler]: the crash is persisted as JSON (shape = NativeCrash
 *   of @bugwatch/react-native) in `filesDir/bugwatch/pending-crash.json` and then the previously
 *   installed handler is invoked.
 * - A watchdog thread detects a main thread blocked for [ANR_TIMEOUT_MS] and persists an "ANR"
 *   report; the report is withdrawn again if the main thread recovers.
 */
object BugwatchCrashHandler {
    private const val DIR_NAME = "bugwatch"
    private const val CRASH_FILE_NAME = "pending-crash.json"
    private const val MAX_FRAMES = 128
    private const val ANR_TIMEOUT_MS = 5000L

    private val installed = AtomicBoolean(false)
    private val handlingCrash = AtomicBoolean(false)
    private val fileLock = Any()

    @Volatile
    private var previousHandler: Thread.UncaughtExceptionHandler? = null

    @Volatile
    private var crashDevice: JSONObject? = null

    @Volatile
    private var crashFile: File? = null

    @Volatile
    private var anrReportPersisted = false

    /** Installs the uncaught exception handler and the ANR watchdog. Idempotent. */
    fun install(context: Context) {
        if (!installed.compareAndSet(false, true)) {
            return
        }
        val app = context.applicationContext ?: context
        crashFile = crashFileFor(app)
        // Resolved now so the crash handler does no IPC (PackageManager) while the process is dying.
        crashDevice = crashDeviceJson(app)

        previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            handleUncaught(thread, throwable)
        }

        val watchdog = AnrWatchdog()
        watchdog.isDaemon = true
        watchdog.start()
    }

    /** The persisted crash from a previous run, or null. A corrupt file is deleted. */
    fun readPendingCrash(context: Context): JSONObject? {
        val file = crashFileFor(context.applicationContext ?: context)
        return synchronized(fileLock) {
            if (!file.exists()) {
                null
            } else {
                try {
                    val json = JSONObject(file.readText(Charsets.UTF_8))
                    if (json.has("type") && json.has("platform")) {
                        json
                    } else {
                        file.delete()
                        null
                    }
                } catch (e: Exception) {
                    file.delete()
                    null
                }
            }
        }
    }

    fun clearPendingCrash(context: Context) {
        val file = crashFileFor(context.applicationContext ?: context)
        synchronized(fileLock) {
            file.delete()
        }
    }

    /** getDeviceInfo payload (null values omitted). */
    fun deviceInfo(context: Context): Map<String, Any?> {
        val app = context.applicationContext ?: context
        val info = LinkedHashMap<String, Any?>()
        info["model"] = Build.MODEL
        info["manufacturer"] = Build.MANUFACTURER
        info["os"] = "Android"
        info["osVersion"] = Build.VERSION.RELEASE
        val pkg = packageInfo(app)
        pkg?.versionName?.let { info["appVersion"] = it }
        if (pkg != null) {
            info["appBuild"] = versionCode(pkg)
        }
        info["locale"] = Locale.getDefault().toLanguageTag()
        info["isEmulator"] = isEmulator()
        return info
    }

    /** Converts a JSON object into plain Maps / Lists / primitives. */
    fun jsonToMap(obj: JSONObject): Map<String, Any?> {
        val map = LinkedHashMap<String, Any?>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            map[key] = unwrap(obj.get(key))
        }
        return map
    }

    private fun unwrap(value: Any?): Any? {
        if (value == null || value == JSONObject.NULL) {
            return null
        }
        if (value is JSONObject) {
            return jsonToMap(value)
        }
        if (value is JSONArray) {
            val list = ArrayList<Any?>(value.length())
            for (i in 0 until value.length()) {
                list.add(unwrap(value.get(i)))
            }
            return list
        }
        return value
    }

    // ---------------------------------------------------------------------------------------
    // Crash path
    // ---------------------------------------------------------------------------------------

    private fun handleUncaught(thread: Thread, throwable: Throwable) {
        try {
            if (handlingCrash.compareAndSet(false, true)) {
                persist(buildExceptionReport(thread, throwable), onlyIfAbsent = false)
            }
        } catch (ignored: Throwable) {
            // Never let crash reporting mask the original crash.
        }

        val previous = previousHandler
        if (previous != null) {
            previous.uncaughtException(thread, throwable)
        } else {
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
    }

    private fun buildExceptionReport(thread: Thread, throwable: Throwable): JSONObject {
        val message = StringBuilder(throwable.message ?: "")
        val root = rootCause(throwable)
        if (root !== throwable) {
            if (message.isNotEmpty()) {
                message.append(' ')
            }
            message.append("(caused by ")
            message.append(root.javaClass.name)
            root.message?.let { message.append(": ").append(it) }
            message.append(')')
        }
        return buildReport(
            type = throwable.javaClass.name,
            message = message.toString(),
            elements = throwable.stackTrace,
            threadName = thread.name,
        )
    }

    private fun rootCause(throwable: Throwable): Throwable {
        var current = throwable
        var depth = 0
        while (depth < 16) {
            val cause = current.cause ?: break
            if (cause === current) {
                break
            }
            current = cause
            depth++
        }
        return current
    }

    private fun buildReport(
        type: String,
        message: String,
        elements: Array<StackTraceElement>,
        threadName: String?,
    ): JSONObject {
        val frames = JSONArray()
        for (element in elements) {
            if (frames.length() >= MAX_FRAMES) {
                break
            }
            val frame = JSONObject()
            frame.put("function", element.methodName)
            frame.put("module", element.className)
            frame.put("filename", element.fileName ?: element.className)
            if (element.lineNumber > 0) {
                frame.put("lineno", element.lineNumber)
            }
            frames.put(frame)
        }

        val report = JSONObject()
        report.put("timestamp", isoNow())
        report.put("platform", "android")
        report.put("type", type)
        report.put("message", message)
        report.put("frames", frames)
        report.put("device", crashDevice ?: fallbackCrashDevice())
        if (threadName != null) {
            report.put("threadName", threadName)
        }
        return report
    }

    /** Writes the report via temp file + rename so a partially written report is never read. */
    private fun persist(report: JSONObject, onlyIfAbsent: Boolean): Boolean {
        val file = crashFile ?: return false
        return synchronized(fileLock) {
            if (onlyIfAbsent && file.exists()) {
                false
            } else {
                val parent = file.parentFile
                if (parent != null && !parent.exists()) {
                    parent.mkdirs()
                }
                val tmp = File(file.parentFile, CRASH_FILE_NAME + ".tmp")
                tmp.writeText(report.toString(), Charsets.UTF_8)
                if (file.exists()) {
                    file.delete()
                }
                if (tmp.renameTo(file)) {
                    true
                } else {
                    tmp.delete()
                    false
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // ANR watchdog
    // ---------------------------------------------------------------------------------------

    private class AnrWatchdog : Thread("bugwatch-anr-watchdog") {
        private val mainHandler = Handler(Looper.getMainLooper())
        private val tickPending = AtomicBoolean(false)
        private val ticker = Runnable { tickPending.set(false) }

        override fun run() {
            while (!isInterrupted) {
                if (tickPending.compareAndSet(false, true)) {
                    mainHandler.post(ticker)
                }
                try {
                    Thread.sleep(ANR_TIMEOUT_MS)
                } catch (e: InterruptedException) {
                    return
                }

                try {
                    if (tickPending.get()) {
                        // The main thread has not run a trivial message for ANR_TIMEOUT_MS.
                        if (!anrReportPersisted &&
                            !handlingCrash.get() &&
                            !Debug.isDebuggerConnected() &&
                            !Debug.waitingForDebugger()
                        ) {
                            anrReportPersisted = persistAnr()
                        }
                    } else if (anrReportPersisted) {
                        // Main thread recovered: it was a stall, not an ANR kill. Withdraw the report
                        // unless a real crash replaced it in the meantime.
                        if (!handlingCrash.get()) {
                            withdrawAnr()
                        }
                        anrReportPersisted = false
                    }
                } catch (ignored: Throwable) {
                    // Watchdog must never take the app down.
                }
            }
        }

        private fun persistAnr(): Boolean {
            val mainThread = Looper.getMainLooper().thread
            val report = buildReport(
                type = "ANR",
                message = "Application Not Responding: main thread blocked for at least ${ANR_TIMEOUT_MS}ms",
                elements = mainThread.stackTrace,
                threadName = mainThread.name,
            )
            return persist(report, onlyIfAbsent = true)
        }

        private fun withdrawAnr() {
            val file = crashFile ?: return
            synchronized(fileLock) {
                file.delete()
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Device helpers
    // ---------------------------------------------------------------------------------------

    private fun crashFileFor(context: Context): File =
        File(File(context.filesDir, DIR_NAME), CRASH_FILE_NAME)

    private fun isoNow(): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date())
    }

    @Suppress("DEPRECATION")
    private fun packageInfo(context: Context): PackageInfo? =
        try {
            context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (e: Exception) {
            null
        }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toString()
        } else {
            info.versionCode.toString()
        }

    private fun crashDeviceJson(context: Context): JSONObject {
        val device = fallbackCrashDevice()
        val pkg = packageInfo(context)
        val appVersion = pkg?.versionName
        if (appVersion != null) {
            device.put("appVersion", appVersion)
        }
        if (pkg != null) {
            device.put("appBuild", versionCode(pkg))
        }
        return device
    }

    private fun fallbackCrashDevice(): JSONObject {
        val device = JSONObject()
        device.put("model", Build.MODEL)
        device.put("os", "Android")
        device.put("osVersion", Build.VERSION.RELEASE)
        return device
    }

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.contains("emulator") ||
            Build.MODEL.contains("Emulator") ||
            Build.MODEL.contains("Android SDK built for") ||
            Build.MODEL.startsWith("sdk_gphone") ||
            Build.HARDWARE.contains("goldfish") ||
            Build.HARDWARE.contains("ranchu") ||
            Build.PRODUCT.contains("sdk_gphone") ||
            Build.PRODUCT.contains("emulator")
}
