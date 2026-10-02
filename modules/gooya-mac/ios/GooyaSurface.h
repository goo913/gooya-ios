#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A view of one of the app's React Native components (registered with AppRegistry) in the React Native that is
 * already running, for a second window (the Mac's Settings window). React Native is reached at run time, as its
 * headers are not this module's.
 */
@interface GooyaSurface : NSObject

/** `factory` is the app delegate's RCTReactNativeFactory; nil while React Native is not running. */
+ (nullable UIView *)viewWithFactory:(id)factory moduleName:(NSString *)moduleName properties:(NSDictionary *)properties;

/** New properties for the component (it renders again with them). */
+ (void)setProperties:(NSDictionary *)properties ofView:(UIView *)view;

@end

NS_ASSUME_NONNULL_END
