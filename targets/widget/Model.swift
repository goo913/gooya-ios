import SwiftUI
import WidgetKit

/// The large and extra large widgets' layouts (Edit Widget → Layout; one setting for both, as iPadOS tells the settings
/// sheet an extra large widget is a large one). The extra large size draws each wider: the list beside the grid
/// instead of under it, or the grid across the whole width.
enum WidgetLayout: String, CaseIterable, Sendable {
  /// This week and the next, what is on each day, and the list of what is coming. The default.
  case twoWeeks
  /// The month (large: a dot per person and day; extra large: what is on each day), and the list.
  case monthList
  /// This week and the next alone, with room for more on each day.
  case twoWeeksOnly
  /// The whole month, with what is on each day in its cell.
  case month

  var isMonth: Bool { self == .monthList || self == .month }
  var hasList: Bool { self == .twoWeeks || self == .monthList }
}

/// Edit Widget → Appearance: as the iPhone is, or always light or always dark.
enum WidgetAppearance: String, CaseIterable, Sendable {
  case system, light, dark
}

/// One moment on the widget's timeline: the feed as of that moment and the widget's settings.
struct Entry: TimelineEntry {
  let date: Date
  let feed: Feed?
  let who: String
  var layout: WidgetLayout = .twoWeeks
  var appearance: WidgetAppearance = .system
  var hidden: Set<String> = []
}

/// What one widget size draws, worked out once per timeline entry from the feed and the widget's settings.
struct WidgetModel {
  let feed: Feed
  let who: String
  let now: Date
  /// Whether the widget is dark (its Appearance, or the iPhone's when that is System): colours are picked for it.
  let dark: Bool
  let tz: TimeZone
  let today: String
  /// What the widget shows: the chosen people's items, without the calendars unticked on this phone.
  let items: [FeedItem]
  /// What is still ahead, soonest first (see ahead()).
  let upcoming: [FeedItem]

  init(feed: Feed, who: String, now: Date, dark: Bool, hidden: Set<String> = []) {
    self.feed = feed
    self.who = who
    self.now = now
    self.dark = dark
    tz = TimeZone(identifier: feed.timezone) ?? .current
    today = DayKey.key(for: now, in: tz)
    let wanted = WidgetModel.chosen(who: who, feed: feed)
    items = feed.items.filter { wanted($0.owner) && !($0.calendar.map { hidden.contains($0) } ?? false) }
    upcoming = WidgetModel.ahead(items, today: today, now: now)
  }

  static func chosen(who: String, feed: Feed) -> (String) -> Bool {
    switch who {
    case "me": return { $0 == feed.me }
    case "other": return { $0 == feed.other }
    default: return { _ in true }
    }
  }

  var people: [FeedPerson] { feed.people.filter { WidgetModel.chosen(who: who, feed: feed)($0.key) } }

  // MARK: colours

  func personHex(_ owner: String) -> String {
    guard let p = feed.person(owner) else { return dark ? "#0a84ff" : "#007aff" }
    return dark ? p.colorDark : p.colorLight
  }

  func color(_ owner: String) -> Color { Color(hex: personHex(owner)) }

  /// A task's ring: its category's colour (as the app draws it, however many people are shown); a schedule's own or
  /// category's colour; an event's calendar colour; the owner's colour for anything without one.
  func hex(_ item: FeedItem) -> String {
    item.color ?? personHex(item.owner)
  }

  func name(_ owner: String) -> String { feed.person(owner)?.name ?? owner }

  // MARK: days

  /// Everything on a day, as the app's month cells order it: events and schedules (all-day first, then by time), then
  /// tasks. An event over several days is on each of them.
  func cell(_ day: String) -> [FeedItem] {
    items.filter { $0.isOn(day) }.sorted { a, b in
      if a.isTask != b.isTask { return !a.isTask }
      if a.allDay != b.allDay { return a.allDay }
      return a.start < b.start
    }
  }

  /// Who has something on a day, in the feed's order of people.
  func dots(_ day: String) -> [String] {
    let owners = Set(items.filter { $0.isOn(day) }.map(\.owner))
    return feed.people.map(\.key).filter { owners.contains($0) }
  }

  // MARK: the list

  /// The day an item is listed under: its own, or today for an event that began before today and goes on.
  func listDay(_ item: FeedItem) -> String { max(item.date, today) }

  /// What is still ahead, soonest first: open tasks from today on (today's overdue ones too, as Reminders keeps them),
  /// and events and schedules that have not ended.
  static func ahead(_ items: [FeedItem], today: String, now: Date) -> [FeedItem] {
    let ms = now.timeIntervalSince1970 * 1000
    return items
      .filter { $0.isTask ? !$0.completed && $0.date >= today : $0.lastDay >= today && ($0.allDay || $0.end > ms) }
      .sorted { a, b in
        let da = max(a.date, today), db = max(b.date, today)
        if da != db { return da < db }
        if a.allDay != b.allDay { return a.allDay }
        return a.start < b.start
      }
  }

  /// Today's part of the list.
  var todays: [FeedItem] { upcoming.filter { listDay($0) == today } }

  func upcoming(from key: String, limit: Int) -> [FeedItem] { Array(upcoming.filter { listDay($0) >= key }.prefix(limit)) }

  /// A timed task whose time has passed today without being ticked off.
  func overdue(_ item: FeedItem) -> Bool {
    item.isTask && !item.allDay && item.date == today && item.end <= now.timeIntervalSince1970 * 1000
  }

  /// What is on now or next today, for the medium widget's left side: a timed item not yet over, else what is left
  /// of today (an all-day item, or a task whose time has passed).
  var next: FeedItem? {
    let ms = now.timeIntervalSince1970 * 1000
    return todays.first { !$0.allDay && $0.end > ms } ?? todays.first
  }

  /// The list by day, as many rows as `lines` allows (a day's heading counts as `heading` of a row). `perDay` caps
  /// each day after today, so later days get a look in.
  func groups(from items: [FeedItem], lines: Double, heading: Double = 0.75, perDay: Int = .max) -> [DayGroup] {
    var groups: [DayGroup] = []
    var used = 0.0
    var index: [String: Int] = [:]
    for item in items {
      let day = listDay(item)
      if let i = index[day] {
        if used + 1 > lines { break }
        if day != today && groups[i].items.count >= perDay { continue }
        groups[i].items.append(item)
        used += 1
      } else {
        if used + heading + 1 > lines { break }
        index[day] = groups.count
        groups.append(DayGroup(day: day, items: [item]))
        used += heading + 1
      }
    }
    return groups
  }

  /// The month's weeks, Sunday first, with nil for the days of the months before and after it (or, `filled`, those
  /// days too, as an iPad's month view shows them).
  func monthRows(filled: Bool = false) -> [[String?]] {
    let first = "\(month)-01"
    let startCol = DayKey.weekday(first)
    let days = DayKey.daysInMonth(first)
    let rows = Int((Double(startCol + days) / 7).rounded(.up))
    let start = DayKey.add(first, days: -startCol)
    return (0..<rows).map { r in
      (0..<7).map { c in
        let key = DayKey.add(start, days: r * 7 + c)
        return filled || key.hasPrefix(month) ? key : nil
      }
    }
  }

  /// This month, "YYYY-MM".
  var month: String { String(today.prefix(7)) }

  /// This week and the ones after it, Sunday first.
  func weekRows(_ count: Int) -> [[String?]] {
    let start = DayKey.sunday(today)
    return (0..<count).map { w in (0..<7).map { c in DayKey.add(start, days: w * 7 + c) } }
  }

  /// A time as short as a wide day's chip writes it: "12 PM", "9:30 AM".
  func shortTime(_ item: FeedItem) -> String {
    item.time.replacingOccurrences(of: ":00 ", with: " ")
  }

  func dayLabel(_ key: String) -> String {
    if key == today { return "Today" }
    if key == DayKey.add(today, days: 1) { return "Tomorrow" }
    return "\(DayKey.dayNames[DayKey.weekday(key)]) \(DayKey.parts(key).d)"
  }

  var weekdayName: String { DayKey.dayNames[DayKey.weekday(today)] }
  var dayNumber: Int { DayKey.parts(today).d }
  var monthTitle: String { DayKey.monthNames[DayKey.parts(today).m - 1] }

  static func url(_ key: String) -> URL { URL(string: "gooya://day/\(key)")! }
  /// GOOYA as it opens: today in the view chosen in its Settings → Default View (src/app/open.tsx).
  static let openURL = URL(string: "gooya://open")!
}

struct DayGroup: Identifiable {
  let day: String
  var items: [FeedItem]
  var id: String { day }
}

// MARK: - Colours

/// "#rrggbb" → red, green, blue in 0…1.
func rgb(hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat)? {
  var text = hex.trimmingCharacters(in: .whitespaces)
  if text.hasPrefix("#") { text.removeFirst() }
  guard text.count >= 6, let value = UInt32(text.prefix(6), radix: 16) else { return nil }
  return (CGFloat((value >> 16) & 0xff) / 255, CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255)
}

extension Color {
  /// A fixed colour from "#rrggbb" (the widget picks the light or dark value itself, for its Appearance setting).
  init(hex: String) {
    let c = rgb(hex: hex) ?? (0.56, 0.56, 0.58)
    self.init(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: 1)
  }

  /// `amount` of the colour over `base` (the app's mix()).
  init(hex: String, over base: String, amount: CGFloat) {
    let a = rgb(hex: hex) ?? (0.56, 0.56, 0.58)
    let b = rgb(hex: base) ?? (0, 0, 0)
    self.init(.sRGB, red: a.r * amount + b.r * (1 - amount), green: a.g * amount + b.g * (1 - amount), blue: a.b * amount + b.b * (1 - amount), opacity: 1)
  }

  /// The colour at a lightness that reads on its own tint (the app's readableTint()): light in dark mode, deep in light.
  init(readable hex: String, dark: Bool) {
    let c = rgb(hex: hex) ?? (0.56, 0.56, 0.58)
    let hi = max(c.r, c.g, c.b), lo = min(c.r, c.g, c.b)
    let l = (hi + lo) / 2
    var h: CGFloat = 0, s: CGFloat = 0
    if hi != lo {
      let d = hi - lo
      s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo)
      h = hi == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6 : 0) : hi == c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4
      h /= 6
    }
    let lightness = dark ? max(l, 0.6) : min(l, 0.38)
    // HSL → RGB.
    let q = lightness < 0.5 ? lightness * (1 + s) : lightness + s - lightness * s
    let p = 2 * lightness - q
    func channel(_ t0: CGFloat) -> CGFloat {
      var t = t0
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1 / 6 { return p + (q - p) * 6 * t }
      if t < 1 / 2 { return q }
      if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
      return p
    }
    if s == 0 {
      self.init(.sRGB, red: lightness, green: lightness, blue: lightness, opacity: 1)
    } else {
      self.init(.sRGB, red: channel(h + 1 / 3), green: channel(h), blue: channel(h - 1 / 3), opacity: 1)
    }
  }
}
