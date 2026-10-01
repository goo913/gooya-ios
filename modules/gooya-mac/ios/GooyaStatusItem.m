#import "GooyaStatusItem.h"
#import <UIKit/UIKit.h>
#import <objc/message.h>

// AppKit's methods GOOYA calls, declared for the compiler only; each protocol stands for one AppKit class.
@protocol GooyaNSStatusBar <NSObject>
- (id)statusItemWithLength:(CGFloat)length;
- (void)removeStatusItem:(id)item;
@end

@protocol GooyaNSStatusItem <NSObject>
- (id)button;
- (void)setMenu:(id)menu;
@end

@protocol GooyaNSStatusBarButton <NSObject>
- (void)setImage:(id)image;
- (void)setToolTip:(NSString *)toolTip;
@end

@protocol GooyaNSImage <NSObject>
- (instancetype)initWithCGImage:(CGImageRef)image size:(CGSize)size;
- (void)setTemplate:(BOOL)isTemplate;
@end

@protocol GooyaNSMenu <NSObject>
- (void)addItem:(id)item;
- (void)setAutoenablesItems:(BOOL)flag;
@end

@protocol GooyaNSMenuItem <NSObject>
- (instancetype)initWithTitle:(NSString *)title action:(nullable SEL)action keyEquivalent:(NSString *)key;
- (void)setTarget:(nullable id)target;
- (void)setRepresentedObject:(nullable id)object;
- (nullable id)representedObject;
- (void)setEnabled:(BOOL)enabled;
- (void)setImage:(nullable id)image;
- (void)setSubtitle:(nullable NSString *)subtitle;
@end

@protocol GooyaNSApplication <NSObject>
- (void)activate;
- (void)activateIgnoringOtherApps:(BOOL)flag;
@end

static id GooyaClassCall(NSString *className, NSString *selector) {
  Class cls = NSClassFromString(className);
  SEL sel = NSSelectorFromString(selector);
  if (!cls || ![cls respondsToSelector:sel]) return nil;
  return ((id (*)(id, SEL))objc_msgSend)(cls, sel);
}

static id GooyaAlloc(NSString *className) {
  Class cls = NSClassFromString(className);
  return cls ? [cls alloc] : nil;
}

@implementation GooyaStatusItem {
  id _item;
}

+ (instancetype)shared {
  static GooyaStatusItem *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ shared = [GooyaStatusItem new]; });
  return shared;
}

+ (void)activateApp {
  id<GooyaNSApplication> app = GooyaClassCall(@"NSApplication", @"sharedApplication");
  if ([app respondsToSelector:@selector(activate)]) [app activate];
  else if ([app respondsToSelector:@selector(activateIgnoringOtherApps:)]) [app activateIgnoringOtherApps:YES];
}

- (void)showWithSections:(NSArray<NSDictionary *> *)sections actions:(NSArray<NSDictionary *> *)actions {
#if TARGET_OS_MACCATALYST
  if (!_item) {
    id<GooyaNSStatusBar> bar = GooyaClassCall(@"NSStatusBar", @"systemStatusBar");
    if (!bar) return;
    _item = [bar statusItemWithLength:-1]; // NSVariableStatusItemLength
    id<GooyaNSStatusBarButton> button = [(id<GooyaNSStatusItem>)_item button];
    [button setImage:[self symbol:@"calendar"]];
    [button setToolTip:@"GOOYA"];
  }
  id<GooyaNSMenu> menu = [GooyaAlloc(@"NSMenu") init];
  [menu setAutoenablesItems:NO];
  BOOL first = YES;
  for (NSDictionary *section in sections) {
    if (!first) [menu addItem:GooyaClassCall(@"NSMenuItem", @"separatorItem")];
    first = NO;
    [menu addItem:[self headerItem:section[@"title"] ?: @""]];
    NSArray *rows = section[@"rows"];
    if (rows.count == 0) {
      id<GooyaNSMenuItem> none = [GooyaAlloc(@"NSMenuItem") initWithTitle:@"Nothing scheduled" action:nil keyEquivalent:@""];
      [none setEnabled:NO];
      [menu addItem:none];
    }
    for (NSDictionary *row in rows) {
      id<GooyaNSMenuItem> item = [GooyaAlloc(@"NSMenuItem") initWithTitle:row[@"title"] ?: @"" action:@selector(choose:) keyEquivalent:@""];
      [item setTarget:self];
      [item setRepresentedObject:row[@"key"]];
      NSString *detail = row[@"detail"];
      if (detail.length && [item respondsToSelector:@selector(setSubtitle:)]) [item setSubtitle:detail];
      NSString *color = row[@"color"];
      if (color.length) [item setImage:[self dot:color]];
      [menu addItem:item];
    }
  }
  if (actions.count) [menu addItem:GooyaClassCall(@"NSMenuItem", @"separatorItem")];
  for (NSDictionary *action in actions) {
    id<GooyaNSMenuItem> item = [GooyaAlloc(@"NSMenuItem") initWithTitle:action[@"title"] ?: @"" action:@selector(choose:) keyEquivalent:@""];
    [item setTarget:self];
    [item setRepresentedObject:action[@"key"]];
    [menu addItem:item];
  }
  [(id<GooyaNSStatusItem>)_item setMenu:menu];
#endif
}

- (void)hide {
  if (!_item) return;
  id<GooyaNSStatusBar> bar = GooyaClassCall(@"NSStatusBar", @"systemStatusBar");
  [bar removeStatusItem:_item];
  _item = nil;
}

- (void)choose:(id)sender {
  NSString *key = [(id<GooyaNSMenuItem>)sender representedObject];
  if (key && self.onSelect) self.onSelect(key);
}

/// A section's heading: macOS's own style where it has one, else a title that cannot be chosen.
- (id)headerItem:(NSString *)title {
  Class cls = NSClassFromString(@"NSMenuItem");
  SEL sel = NSSelectorFromString(@"sectionHeaderWithTitle:");
  if (cls && [cls respondsToSelector:sel]) return ((id (*)(id, SEL, NSString *))objc_msgSend)(cls, sel, title);
  id<GooyaNSMenuItem> item = [GooyaAlloc(@"NSMenuItem") initWithTitle:title action:nil keyEquivalent:@""];
  [item setEnabled:NO];
  return item;
}

/// An SF Symbol as a template image, tinted by the menu bar.
- (id)symbol:(NSString *)name {
  Class cls = NSClassFromString(@"NSImage");
  SEL sel = NSSelectorFromString(@"imageWithSystemSymbolName:accessibilityDescription:");
  if (!cls || ![cls respondsToSelector:sel]) return nil;
  id<GooyaNSImage> image = ((id (*)(id, SEL, NSString *, NSString *))objc_msgSend)(cls, sel, name, @"GOOYA");
  [image setTemplate:YES];
  return image;
}

/// A dot in a row's color ("#rrggbb"): the person's, the category's or the calendar's, as on GOOYA's calendar.
- (id)dot:(NSString *)hex {
  unsigned int value = 0;
  NSString *digits = [hex hasPrefix:@"#"] ? [hex substringFromIndex:1] : hex;
  if (![[NSScanner scannerWithString:digits] scanHexInt:&value]) return nil;
  UIColor *color = [UIColor colorWithRed:((value >> 16) & 0xff) / 255.0 green:((value >> 8) & 0xff) / 255.0 blue:(value & 0xff) / 255.0 alpha:1];
  CGSize size = CGSizeMake(10, 10);
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = 2;
  UIImage *image = [[[UIGraphicsImageRenderer alloc] initWithSize:size format:format] imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [color setFill];
    [[UIBezierPath bezierPathWithOvalInRect:CGRectMake(1, 1, 8, 8)] fill];
  }];
  return [GooyaAlloc(@"NSImage") initWithCGImage:image.CGImage size:size];
}

@end
