#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Native crash capture for Bugwatch (iOS).
 *
 * Installs an NSException handler and POSIX signal handlers. On a crash a JSON document
 * shaped like the `NativeCrash` type of @bugwatch/react-native is persisted under
 * Application Support/Bugwatch/pending-crash.json. The JS SDK reads it on the next launch.
 */
@interface BugwatchCrashHandler : NSObject

/** Installs the crash handlers. Idempotent. */
+ (void)install;

/** The crash persisted by a previous run (NativeCrash shape), or nil. */
+ (nullable NSDictionary<NSString *, id> *)pendingCrash;

/** Deletes the persisted crash. */
+ (void)clearPendingCrash;

/** Device / app information (getDeviceInfo shape). */
+ (NSDictionary<NSString *, id> *)deviceInfo;

@end

NS_ASSUME_NONNULL_END
