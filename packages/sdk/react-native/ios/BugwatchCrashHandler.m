#import "BugwatchCrashHandler.h"

#import <TargetConditionals.h>
#import <dlfcn.h>
#import <errno.h>
#import <execinfo.h>
#import <fcntl.h>
#import <limits.h>
#import <pthread.h>
#import <signal.h>
#import <stdatomic.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>
#import <sys/utsname.h>
#import <time.h>
#import <unistd.h>

// ---------------------------------------------------------------------------------------------
// Constants and global state
//
// Everything the signal handler touches is allocated / computed in +install so that the handler
// itself performs no allocation, takes no locks and calls no Objective-C.
// ---------------------------------------------------------------------------------------------

#define BW_MAX_FRAMES 128
#define BW_BUFFER_SIZE (64 * 1024)
#define BW_FRAME_RESERVE 8192
#define BW_ALT_STACK_SIZE (128 * 1024)
#define BW_SIGNAL_COUNT 7

static NSString *const kBWCrashFileName = @"pending-crash.json";
static NSString *const kBWStorageDirName = @"Bugwatch";

static const int kBWSignals[BW_SIGNAL_COUNT] = {SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGSYS, SIGTRAP};
static struct sigaction gBWPreviousActions[BW_SIGNAL_COUNT];
static NSUncaughtExceptionHandler *gBWPreviousExceptionHandler = NULL;

static char gBWCrashPath[PATH_MAX];
static char gBWCrashTmpPath[PATH_MAX + 8];
static char *gBWDeviceJSON = NULL; // JSON object text: {"model":...}
static char *gBWBuffer = NULL;

// 0 = nobody is writing a crash report, 1 = a handler claimed the right to write one.
static atomic_int gBWHandling = 0;
// Set once the crash file has been written (or the attempt finished).
static volatile sig_atomic_t gBWCrashWritten = 0;

// ---------------------------------------------------------------------------------------------
// Async-signal-safe string building
// ---------------------------------------------------------------------------------------------

typedef struct {
    char *buf;
    size_t len;
    size_t cap;
} BWWriter;

static void bw_putc(BWWriter *w, char c) {
    if (w->len + 1 < w->cap) {
        w->buf[w->len++] = c;
    }
}

static void bw_append(BWWriter *w, const char *s) {
    if (s == NULL) {
        return;
    }
    while (*s != '\0') {
        bw_putc(w, *s++);
    }
}

// Appends `s` as a quoted JSON string. Non-ASCII bytes are replaced with '?' so that the output
// is always valid UTF-8 / JSON. At most `maxLen` input bytes are consumed.
static void bw_append_json_string(BWWriter *w, const char *s, size_t maxLen) {
    static const char hex[] = "0123456789abcdef";
    bw_putc(w, '"');
    if (s != NULL) {
        for (size_t i = 0; i < maxLen && s[i] != '\0'; i++) {
            unsigned char c = (unsigned char)s[i];
            if (c == '"' || c == '\\') {
                bw_putc(w, '\\');
                bw_putc(w, (char)c);
            } else if (c < 0x20) {
                bw_append(w, "\\u00");
                bw_putc(w, hex[c >> 4]);
                bw_putc(w, hex[c & 0x0f]);
            } else if (c >= 0x7f) {
                bw_putc(w, '?');
            } else {
                bw_putc(w, (char)c);
            }
        }
    }
    bw_putc(w, '"');
}

static void bw_append_hex(BWWriter *w, uintptr_t value) {
    static const char hex[] = "0123456789abcdef";
    char digits[2 * sizeof(uintptr_t)];
    size_t n = 0;
    do {
        digits[n++] = hex[value & 0xf];
        value >>= 4;
    } while (value != 0 && n < sizeof(digits));
    bw_append(w, "0x");
    while (n > 0) {
        bw_putc(w, digits[--n]);
    }
}

static void bw_append_padded(BWWriter *w, unsigned long long value, int width) {
    char digits[24];
    int n = 0;
    do {
        digits[n++] = (char)('0' + (value % 10));
        value /= 10;
    } while (value != 0 && n < (int)sizeof(digits));
    for (int i = n; i < width; i++) {
        bw_putc(w, '0');
    }
    while (n > 0) {
        bw_putc(w, digits[--n]);
    }
}

// Appends the current UTC time as YYYY-MM-DDTHH:MM:SS.mmmZ. Pure arithmetic, no libc time zone
// machinery (civil-from-days, H. Hinnant).
static void bw_append_iso8601(BWWriter *w) {
    struct timespec ts;
    ts.tv_sec = 0;
    ts.tv_nsec = 0;
    clock_gettime(CLOCK_REALTIME, &ts);

    long long total = (long long)ts.tv_sec;
    long long days = total / 86400;
    long long secs = total % 86400;
    if (secs < 0) {
        secs += 86400;
        days -= 1;
    }

    days += 719468;
    long long era = (days >= 0 ? days : days - 146096) / 146097;
    unsigned long long doe = (unsigned long long)(days - era * 146097);
    unsigned long long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    long long year = (long long)yoe + era * 400;
    unsigned long long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    unsigned long long mp = (5 * doy + 2) / 153;
    unsigned long long day = doy - (153 * mp + 2) / 5 + 1;
    unsigned long long month = mp < 10 ? mp + 3 : mp - 9;
    if (month <= 2) {
        year += 1;
    }

    bw_append_padded(w, (unsigned long long)year, 4);
    bw_putc(w, '-');
    bw_append_padded(w, month, 2);
    bw_putc(w, '-');
    bw_append_padded(w, day, 2);
    bw_putc(w, 'T');
    bw_append_padded(w, (unsigned long long)(secs / 3600), 2);
    bw_putc(w, ':');
    bw_append_padded(w, (unsigned long long)((secs % 3600) / 60), 2);
    bw_putc(w, ':');
    bw_append_padded(w, (unsigned long long)(secs % 60), 2);
    bw_putc(w, '.');
    bw_append_padded(w, (unsigned long long)(ts.tv_nsec / 1000000), 3);
    bw_putc(w, 'Z');
}

static const char *bw_basename(const char *path) {
    if (path == NULL) {
        return NULL;
    }
    const char *slash = strrchr(path, '/');
    return slash != NULL ? slash + 1 : path;
}

static const char *bw_signal_name(int sig) {
    switch (sig) {
        case SIGABRT: return "SIGABRT";
        case SIGBUS: return "SIGBUS";
        case SIGFPE: return "SIGFPE";
        case SIGILL: return "SIGILL";
        case SIGSEGV: return "SIGSEGV";
        case SIGSYS: return "SIGSYS";
        case SIGTRAP: return "SIGTRAP";
        default: return "SIGNAL";
    }
}

static const char *bw_signal_description(int sig) {
    switch (sig) {
        case SIGABRT: return "Abort";
        case SIGBUS: return "Bus error";
        case SIGFPE: return "Arithmetic exception";
        case SIGILL: return "Illegal instruction";
        case SIGSEGV: return "Segmentation fault";
        case SIGSYS: return "Bad system call";
        case SIGTRAP: return "Trace / breakpoint trap";
        default: return "Unknown signal";
    }
}

// ---------------------------------------------------------------------------------------------
// Persisting
// ---------------------------------------------------------------------------------------------

// Writes `buf` to the temp path and renames it over the crash file so a half-written report is
// never picked up. open / write / close / rename are all async-signal-safe.
static void bw_persist_buffer(const char *buf, size_t len) {
    if (gBWCrashPath[0] == '\0' || buf == NULL || len == 0) {
        return;
    }
    int fd = open(gBWCrashTmpPath, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        return;
    }
    size_t off = 0;
    while (off < len) {
        ssize_t r = write(fd, buf + off, len - off);
        if (r < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        off += (size_t)r;
    }
    close(fd);
    if (off == len) {
        rename(gBWCrashTmpPath, gBWCrashPath);
    } else {
        unlink(gBWCrashTmpPath);
    }
}

// Builds the NativeCrash JSON for a POSIX signal into the preallocated buffer and persists it.
static void bw_write_signal_crash(int sig, siginfo_t *info) {
    if (gBWBuffer == NULL) {
        return;
    }
    BWWriter w;
    w.buf = gBWBuffer;
    w.len = 0;
    w.cap = BW_BUFFER_SIZE;

    bw_append(&w, "{\"timestamp\":\"");
    bw_append_iso8601(&w);
    bw_append(&w, "\",\"platform\":\"ios\",\"type\":\"");
    bw_append(&w, bw_signal_name(sig));
    bw_append(&w, "\",\"message\":\"Fatal signal ");
    bw_append(&w, bw_signal_name(sig));
    bw_append(&w, " (");
    bw_append(&w, bw_signal_description(sig));
    bw_append(&w, ")");
    if (info != NULL && (sig == SIGSEGV || sig == SIGBUS || sig == SIGILL || sig == SIGFPE)) {
        bw_append(&w, " at address ");
        bw_append_hex(&w, (uintptr_t)info->si_addr);
    }
    bw_append(&w, "\",");

    char threadName[64];
    threadName[0] = '\0';
    pthread_getname_np(pthread_self(), threadName, sizeof(threadName));
    threadName[sizeof(threadName) - 1] = '\0';
    if (threadName[0] != '\0') {
        bw_append(&w, "\"threadName\":");
        bw_append_json_string(&w, threadName, sizeof(threadName));
        bw_append(&w, ",");
    } else if (pthread_main_np()) {
        bw_append(&w, "\"threadName\":\"main\",");
    }

    bw_append(&w, "\"device\":");
    bw_append(&w, gBWDeviceJSON != NULL ? gBWDeviceJSON : "{}");
    bw_append(&w, ",\"frames\":[");

    void *addrs[BW_MAX_FRAMES];
    int count = backtrace(addrs, BW_MAX_FRAMES);
    int wrote = 0;
    // Index 0 is this handler; the first interesting frame is the signal trampoline.
    for (int i = 1; i < count; i++) {
        if (w.len + BW_FRAME_RESERVE > w.cap) {
            break;
        }
        if (wrote) {
            bw_putc(&w, ',');
        }
        wrote = 1;
        bw_append(&w, "{\"address\":\"");
        bw_append_hex(&w, (uintptr_t)addrs[i]);
        bw_append(&w, "\"");

        Dl_info dli;
        memset(&dli, 0, sizeof(dli));
        if (dladdr(addrs[i], &dli) != 0) {
            if (dli.dli_sname != NULL) {
                bw_append(&w, ",\"function\":");
                bw_append_json_string(&w, dli.dli_sname, 256);
            }
            const char *image = bw_basename(dli.dli_fname);
            if (image != NULL && image[0] != '\0') {
                bw_append(&w, ",\"filename\":");
                bw_append_json_string(&w, image, 256);
            }
        }
        bw_putc(&w, '}');
    }
    bw_append(&w, "]}");

    bw_persist_buffer(w.buf, w.len);
}

// ---------------------------------------------------------------------------------------------
// Signal handler + chaining
// ---------------------------------------------------------------------------------------------

static int bw_signal_index(int sig) {
    for (int i = 0; i < BW_SIGNAL_COUNT; i++) {
        if (kBWSignals[i] == sig) {
            return i;
        }
    }
    return -1;
}

// Hands the signal to whatever handler was installed before ours, then lets the process die with
// the default disposition.
static void bw_chain_signal(int sig, siginfo_t *info, void *uctx) {
    int idx = bw_signal_index(sig);
    if (idx >= 0) {
        struct sigaction previous = gBWPreviousActions[idx];
        BOOL isHandler = NO;
        if ((previous.sa_flags & SA_SIGINFO) != 0) {
            isHandler = previous.sa_sigaction != NULL;
        } else {
            isHandler = previous.sa_handler != SIG_DFL && previous.sa_handler != SIG_IGN;
        }
        if (isHandler) {
            sigaction(sig, &previous, NULL);
            if ((previous.sa_flags & SA_SIGINFO) != 0) {
                previous.sa_sigaction(sig, info, uctx);
            } else {
                previous.sa_handler(sig);
            }
        }
    }

    struct sigaction dfl;
    memset(&dfl, 0, sizeof(dfl));
    dfl.sa_handler = SIG_DFL;
    sigemptyset(&dfl.sa_mask);
    sigaction(sig, &dfl, NULL);

    sigset_t unblock;
    sigemptyset(&unblock);
    sigaddset(&unblock, sig);
    pthread_sigmask(SIG_UNBLOCK, &unblock, NULL);
    raise(sig);
}

static void bw_signal_handler(int sig, siginfo_t *info, void *uctx) {
    if (atomic_exchange(&gBWHandling, 1) == 0) {
        bw_write_signal_crash(sig, info);
        gBWCrashWritten = 1;
    } else if (!gBWCrashWritten) {
        // Another thread (or this one, recursively) is mid-write. Give it up to 2s to finish.
        struct timespec nap;
        nap.tv_sec = 0;
        nap.tv_nsec = 10 * 1000 * 1000;
        for (int i = 0; i < 200 && !gBWCrashWritten; i++) {
            nanosleep(&nap, NULL);
        }
    }
    bw_chain_signal(sig, info, uctx);
}

// ---------------------------------------------------------------------------------------------
// Device info + NSException path (normal context, Objective-C is fine here)
// ---------------------------------------------------------------------------------------------

static NSString *bw_machine_identifier(void) {
#if TARGET_OS_SIMULATOR
    const char *simulated = getenv("SIMULATOR_MODEL_IDENTIFIER");
    if (simulated != NULL && simulated[0] != '\0') {
        return [NSString stringWithUTF8String:simulated];
    }
#endif
    struct utsname u;
    if (uname(&u) == 0) {
        return [NSString stringWithUTF8String:u.machine];
    }
    return nil;
}

static NSDictionary<NSString *, id> *bw_device_info(void) {
    NSMutableDictionary<NSString *, id> *info = [NSMutableDictionary dictionary];

    NSString *model = bw_machine_identifier();
    if (model.length > 0) {
        info[@"model"] = model;
    }
    info[@"manufacturer"] = @"Apple";
    info[@"os"] = @"iOS";

    NSOperatingSystemVersion v = [NSProcessInfo processInfo].operatingSystemVersion;
    info[@"osVersion"] = [NSString stringWithFormat:@"%ld.%ld.%ld", (long)v.majorVersion, (long)v.minorVersion, (long)v.patchVersion];

    NSDictionary *bundleInfo = [NSBundle mainBundle].infoDictionary;
    id appVersion = bundleInfo[@"CFBundleShortVersionString"];
    if ([appVersion isKindOfClass:[NSString class]] && [(NSString *)appVersion length] > 0) {
        info[@"appVersion"] = appVersion;
    }
    id appBuild = bundleInfo[@"CFBundleVersion"];
    if ([appBuild isKindOfClass:[NSString class]] && [(NSString *)appBuild length] > 0) {
        info[@"appBuild"] = appBuild;
    }

    NSString *locale = [NSLocale preferredLanguages].firstObject;
    if (locale.length > 0) {
        info[@"locale"] = locale;
    }
#if TARGET_OS_SIMULATOR
    info[@"isEmulator"] = @YES;
#else
    info[@"isEmulator"] = @NO;
#endif
    return info;
}

// The device subset embedded in a crash report (NativeCrash.device).
static NSDictionary<NSString *, id> *bw_crash_device(void) {
    NSDictionary<NSString *, id> *full = bw_device_info();
    NSMutableDictionary<NSString *, id> *device = [NSMutableDictionary dictionary];
    for (NSString *key in @[@"model", @"os", @"osVersion", @"appVersion", @"appBuild"]) {
        id value = full[key];
        if (value != nil) {
            device[key] = value;
        }
    }
    return device;
}

static NSString *bw_iso8601_now(void) {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"];
    formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
    formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
    return [formatter stringFromDate:[NSDate date]];
}

static NSDictionary<NSString *, id> *bw_frame_for_address(uintptr_t address) {
    NSMutableDictionary<NSString *, id> *frame = [NSMutableDictionary dictionary];
    frame[@"address"] = [NSString stringWithFormat:@"0x%lx", (unsigned long)address];
    Dl_info dli;
    memset(&dli, 0, sizeof(dli));
    if (dladdr((const void *)address, &dli) != 0) {
        if (dli.dli_sname != NULL) {
            NSString *function = [NSString stringWithUTF8String:dli.dli_sname];
            if (function.length > 0) {
                frame[@"function"] = function;
            }
        }
        const char *image = bw_basename(dli.dli_fname);
        if (image != NULL && image[0] != '\0') {
            NSString *filename = [NSString stringWithUTF8String:image];
            if (filename.length > 0) {
                frame[@"filename"] = filename;
            }
        }
    }
    return frame;
}

static NSDictionary<NSString *, id> *bw_crash_for_exception(NSException *exception) {
    NSMutableArray<NSDictionary<NSString *, id> *> *frames = [NSMutableArray array];
    for (NSNumber *address in exception.callStackReturnAddresses) {
        if (frames.count >= BW_MAX_FRAMES) {
            break;
        }
        [frames addObject:bw_frame_for_address((uintptr_t)address.unsignedLongLongValue)];
    }
    if (frames.count == 0) {
        for (NSString *symbol in exception.callStackSymbols) {
            if (frames.count >= BW_MAX_FRAMES) {
                break;
            }
            [frames addObject:@{@"function" : symbol}];
        }
    }

    NSMutableDictionary<NSString *, id> *crash = [NSMutableDictionary dictionary];
    crash[@"timestamp"] = bw_iso8601_now();
    crash[@"platform"] = @"ios";
    crash[@"type"] = exception.name.length > 0 ? exception.name : @"NSException";
    crash[@"message"] = exception.reason ?: @"";
    crash[@"frames"] = frames;
    crash[@"device"] = bw_crash_device();
    crash[@"threadName"] = [NSThread isMainThread] ? @"main" : ([NSThread currentThread].name.length > 0 ? [NSThread currentThread].name : @"unknown");
    return crash;
}

static void bw_uncaught_exception_handler(NSException *exception) {
    if (atomic_exchange(&gBWHandling, 1) == 0) {
        @try {
            NSData *data = [NSJSONSerialization dataWithJSONObject:bw_crash_for_exception(exception) options:0 error:nil];
            if (data != nil) {
                bw_persist_buffer((const char *)data.bytes, data.length);
            }
        } @catch (NSException *ignored) {
        }
        gBWCrashWritten = 1;
    }
    if (gBWPreviousExceptionHandler != NULL) {
        gBWPreviousExceptionHandler(exception);
    }
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

static NSString *bw_storage_directory(void) {
    NSString *base = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    if (base.length == 0) {
        base = NSTemporaryDirectory();
    }
    NSString *dir = [base stringByAppendingPathComponent:kBWStorageDirName];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return dir;
}

static NSString *bw_crash_file_path(void) {
    return [bw_storage_directory() stringByAppendingPathComponent:kBWCrashFileName];
}

static void bw_setup_alt_stack(void) {
    stack_t ss;
    ss.ss_sp = malloc(BW_ALT_STACK_SIZE);
    if (ss.ss_sp == NULL) {
        return;
    }
    ss.ss_size = BW_ALT_STACK_SIZE;
    ss.ss_flags = 0;
    sigaltstack(&ss, NULL);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

@implementation BugwatchCrashHandler

+ (void)install {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        @try {
            NSString *path = bw_crash_file_path();
            NSString *tmpPath = [path stringByAppendingString:@".tmp"];
            if (![path getFileSystemRepresentation:gBWCrashPath maxLength:sizeof(gBWCrashPath)] ||
                ![tmpPath getFileSystemRepresentation:gBWCrashTmpPath maxLength:sizeof(gBWCrashTmpPath)]) {
                gBWCrashPath[0] = '\0';
                return;
            }

            gBWBuffer = (char *)malloc(BW_BUFFER_SIZE);
            if (gBWBuffer == NULL) {
                return;
            }

            // Pre-serialize the device block so the signal handler can copy it verbatim.
            NSData *deviceData = [NSJSONSerialization dataWithJSONObject:bw_crash_device() options:0 error:nil];
            NSString *deviceString = deviceData != nil ? [[NSString alloc] initWithData:deviceData encoding:NSUTF8StringEncoding] : nil;
            gBWDeviceJSON = strdup(deviceString.length > 0 ? deviceString.UTF8String : "{}");

            // Warm up lazily-initialised machinery that backtrace()/dladdr() use, so the first call
            // does not happen inside a signal handler.
            void *warm[4];
            backtrace(warm, 4);
            Dl_info warmInfo;
            dladdr((const void *)&bw_signal_handler, &warmInfo);

            // sigaltstack is per thread: arm it on the main thread so stack overflows there are
            // still reportable.
            dispatch_async(dispatch_get_main_queue(), ^{
                bw_setup_alt_stack();
            });

            gBWPreviousExceptionHandler = NSGetUncaughtExceptionHandler();
            NSSetUncaughtExceptionHandler(&bw_uncaught_exception_handler);

            struct sigaction action;
            memset(&action, 0, sizeof(action));
            action.sa_sigaction = bw_signal_handler;
            sigemptyset(&action.sa_mask);
            action.sa_flags = SA_SIGINFO | SA_ONSTACK;
            for (int i = 0; i < BW_SIGNAL_COUNT; i++) {
                sigaction(kBWSignals[i], &action, &gBWPreviousActions[i]);
            }
        } @catch (NSException *ignored) {
        }
    });
}

+ (nullable NSDictionary<NSString *, id> *)pendingCrash {
    NSString *path = bw_crash_file_path();
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data == nil || data.length == 0) {
        return nil;
    }
    id parsed = nil;
    @try {
        parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    } @catch (NSException *ignored) {
        parsed = nil;
    }
    if ([parsed isKindOfClass:[NSDictionary class]] && [((NSDictionary *)parsed)[@"type"] isKindOfClass:[NSString class]]) {
        return (NSDictionary<NSString *, id> *)parsed;
    }
    // Corrupt or truncated report: drop it so it is not retried forever.
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
    return nil;
}

+ (void)clearPendingCrash {
    [[NSFileManager defaultManager] removeItemAtPath:bw_crash_file_path() error:nil];
}

+ (NSDictionary<NSString *, id> *)deviceInfo {
    return bw_device_info();
}

@end
