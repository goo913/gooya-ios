#import "GooyaSurface.h"

// React Native's methods GOOYA calls, declared for the compiler only; each protocol stands for one class.
@protocol GooyaReactHost <NSObject>
- (id)createSurfaceWithModuleName:(NSString *)moduleName initialProperties:(NSDictionary *)properties;
@end

@protocol GooyaSurfaceRootView <NSObject>
- (instancetype)initWithSurface:(id)surface;
- (void)setAppProperties:(NSDictionary *)properties;
@end

@implementation GooyaSurface

+ (UIView *)viewWithFactory:(id)factory moduleName:(NSString *)moduleName properties:(NSDictionary *)properties
{
  id rootViewFactory = [factory valueForKey:@"rootViewFactory"];
  id host = [rootViewFactory valueForKey:@"reactHost"];
  Class cls = NSClassFromString(@"RCTSurfaceHostingProxyRootView");
  if (!host || !cls || ![host respondsToSelector:@selector(createSurfaceWithModuleName:initialProperties:)]) return nil;
  // The host starts the surface once the app's JavaScript has run; the view stops it when it goes.
  id surface = [(id<GooyaReactHost>)host createSurfaceWithModuleName:moduleName initialProperties:properties];
  UIView *view = [(id<GooyaSurfaceRootView>)[cls alloc] initWithSurface:surface];
  view.backgroundColor = UIColor.clearColor;
  return view;
}

+ (void)setProperties:(NSDictionary *)properties ofView:(UIView *)view
{
  if ([view respondsToSelector:@selector(setAppProperties:)]) [(id<GooyaSurfaceRootView>)view setAppProperties:properties];
}

@end
