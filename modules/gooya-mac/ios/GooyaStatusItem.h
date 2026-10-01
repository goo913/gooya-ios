#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * GOOYA's icon in the Mac's menu bar: its menu lists what is on today and tomorrow (a row opens its day), then a few
 * actions. AppKit's status bar is reached at run time: a Mac Catalyst app cannot link AppKit, but every Mac Catalyst
 * process has it loaded. On an iPhone or iPad nothing happens.
 */
@interface GooyaStatusItem : NSObject

+ (instancetype)shared;

/**
 * Shows the icon with `sections` ([{ "title": "Today", "rows": [{ "key", "title", "detail", "color": "#rrggbb" }] }],
 * a section without rows says it is free) and, under them, `actions` ([{ "key", "title" }]).
 */
- (void)showWithSections:(NSArray<NSDictionary *> *)sections actions:(NSArray<NSDictionary *> *)actions;
- (void)hide;

/** A row or an action was chosen: its key. */
@property (nonatomic, copy, nullable) void (^onSelect)(NSString *key);

/** Brings GOOYA in front of other apps. */
+ (void)activateApp;

@end

NS_ASSUME_NONNULL_END
