#import <React/RCTBridgeModule.h>

#import "BugwatchCrashHandler.h"

// Classic React Native bridge module (also served through the new-architecture interop layer).
// JS name: NativeModules.BugwatchNative
@interface BugwatchNativeModule : NSObject <RCTBridgeModule>
@end

@implementation BugwatchNativeModule

RCT_EXPORT_MODULE(BugwatchNative)

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

RCT_EXPORT_METHOD(install)
{
    [BugwatchCrashHandler install];
}

RCT_EXPORT_METHOD(getPendingCrash
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
    NSDictionary *crash = [BugwatchCrashHandler pendingCrash];
    resolve(crash != nil ? crash : [NSNull null]);
}

RCT_EXPORT_METHOD(clearPendingCrash
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
    [BugwatchCrashHandler clearPendingCrash];
    resolve([NSNull null]);
}

RCT_EXPORT_METHOD(getDeviceInfo
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
    resolve([BugwatchCrashHandler deviceInfo]);
}

@end
