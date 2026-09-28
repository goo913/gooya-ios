import SwiftUI
import WidgetKit

/// One moment on the widget's timeline: the feed as of that moment and the "Show" choice.
struct Entry: TimelineEntry {
  let date: Date
  let feed: Feed?
  let who: String
}

/// What one widget size draws, worked out once per timeline entry from the feed and the "Show" choice.
struct WidgetModel {
  let feed: Feed
  let who: String
  let now: Date
  let tz: TimeZone
  let today: String

  init(feed: Feed, who: String, now: Date) {
    self.feed = feed
    self.who = who
    self.now = now
    tz = TimeZone(identifier: feed.timezone) ?? .current
    today = DayKey.key(for: now, in: tz)
  }

  func wanted(_ owner: String) -> Bool {
    switch who {
    case "me": return owner == feed.me
    case "other": return owner == feed.other
    default: return true
    }
  }

  var people: [FeedPerson] { feed.people.filter { wanted($0.key) } }

  func color(_ owner: String) -> Color {
    guard let p = feed.person(owner) else { return .primary }
    return Color(light: p.colorLight, dark: p.colorDark)
  }

  func name(_ owner: String) -> String { feed.person(owner)?.name ?? owner }

  /// Open items for the chosen people, today and later, soonest first.
  var open: [FeedItem] {
    feed.items
      .filter { !$0.completed && wanted($0.owner) && $0.date >= today }
      .sorted { a, b in
        if a.date != b.date { return a.date < b.date }
        if a.allDay != b.allDay { return a.allDay }
        return a.start < b.start
      }
  }

  /// Today's open items, the overdue ones included (as Reminders does), in time order.
  var todays: [FeedItem] { open.filter { $0.date == today } }

  /// A timed item whose time has passed today without being ticked off.
  func overdue(_ item: FeedItem) -> Bool {
    !item.allDay && item.date == today && item.end <= now.timeIntervalSince1970 * 1000
  }

  func upcoming(from key: String, limit: Int) -> [FeedItem] { Array(open.filter { $0.date >= key }.prefix(limit)) }

  /// Today's schedule blocks still running or ahead, for the chosen people.
  var schedules: [FeedSchedule] {
    let ms = now.timeIntervalSince1970 * 1000
    return feed.schedules.filter { wanted($0.owner) && $0.end > ms }
  }

  func dots(_ key: String) -> [String] { (feed.dots[key] ?? []).filter { wanted($0) } }

  func dayLabel(_ key: String) -> String {
    if key == today { return "Today" }
    if key == DayKey.add(today, days: 1) { return "Tomorrow" }
    return "\(DayKey.dayNames[DayKey.weekday(key)]) \(DayKey.parts(key).d)"
  }

  var weekdayName: String { DayKey.dayNames[DayKey.weekday(today)] }
  var dayNumber: Int { DayKey.parts(today).d }
  var monthTitle: String {
    let p = DayKey.parts(today)
    return "\(DayKey.monthNames[p.m - 1]) \(p.y)"
  }

  static func url(_ key: String) -> URL { URL(string: "gooya://day/\(key)")! }
}

/// "#rrggbb" → red, green, blue in 0…1.
func rgb(hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat)? {
  var text = hex.trimmingCharacters(in: .whitespaces)
  if text.hasPrefix("#") { text.removeFirst() }
  guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
  return (CGFloat((value >> 16) & 0xff) / 255, CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255)
}

#if canImport(UIKit)
import UIKit

extension Color {
  /// A colour that follows light and dark mode, from the two hex values the feed carries.
  init(light: String, dark: String) {
    self.init(UIColor { traits in
      guard let c = rgb(hex: traits.userInterfaceStyle == .dark ? dark : light) else { return .label }
      return UIColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
    })
  }
}
#elseif canImport(AppKit)
import AppKit

// The same colours on a Mac: npm run widget:preview draws the widget's views there to check them.
extension Color {
  init(light: String, dark: String) {
    self.init(nsColor: NSColor(name: nil) { appearance in
      let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      guard let c = rgb(hex: isDark ? dark : light) else { return .labelColor }
      return NSColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
    })
  }
}
#endif
