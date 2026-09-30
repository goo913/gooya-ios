import Foundation

// The feed the app writes into the App Group (shared/widgetFeed.ts builds it; src/lib/widget.ts stores it) and the
// widgetFeed Cloud Function serves. Field names follow the TypeScript types in shared/widgetFeed.ts; what a feed from
// before schedules existed does not have is optional.

struct FeedPerson: Codable, Hashable {
  let key: String
  let name: String
  let timezone: String
  let colorLight: String
  let colorDark: String
}

struct FeedItem: Codable, Identifiable, Hashable {
  let id: String
  /// "task", "schedule" or "event".
  let kind: String?
  /// The task's, schedule's or event's id.
  let taskId: String
  let owner: String
  let title: String
  let allDay: Bool
  let start: Double
  let end: Double
  /// The first and the last day it is on (only events and schedules run over several days).
  let date: String
  let endDate: String?
  /// "all-day" or the start time ("12:00 PM").
  let time: String
  let completed: Bool
  let flagged: Bool?
  let priority: Int?
  let listId: String?
  /// An event's calendar colour, a task's list colour; none for a schedule (its owner's colour).
  let color: String?
  /// The calendar of an event or schedule ("accountId:calendarId", "gooya:schedules").
  let calendar: String?

  var isTask: Bool { (kind ?? "task") == "task" }
  var lastDay: String { max(endDate ?? date, date) }
  func isOn(_ day: String) -> Bool { date <= day && day <= lastDay }
}

struct Feed: Codable, Hashable {
  let generatedAt: Double
  let me: String
  let other: String
  let timezone: String
  let today: String
  let people: [FeedPerson]
  let items: [FeedItem]
  let appUrl: String?

  func person(_ key: String) -> FeedPerson? { people.first { $0.key == key } }
}

/// Where the app and the widget meet: the App Group's UserDefaults, plus the server when the copy there is old.
enum FeedStore {
  /// "group." + the app's bundle id (the widget's id is the app's plus ".widget"), as app.config.ts declares it.
  static var groupId: String {
    let mine = Bundle.main.bundleIdentifier ?? "com.hybertec.gooya.widget"
    let app = mine.hasSuffix(".widget") ? String(mine.dropLast(".widget".count)) : mine
    return "group.\(app)"
  }
  static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }
  static let feedURL = URL(string: "https://us-east1-gooya-37d79.cloudfunctions.net/widgetFeed")!
  /// How old the app's copy may be before the widget asks the server (the other person may have added things).
  static let maxAge: TimeInterval = 20 * 60

  static func cached() -> Feed? {
    guard let text = defaults?.string(forKey: "feed"), let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Feed.self, from: data)
  }

  static func token() -> String? {
    guard let t = defaults?.string(forKey: "token"), !t.isEmpty else { return nil }
    return t
  }

  /// The calendars unticked on this phone (the app's Calendars screen), which the widget leaves out too.
  static func hidden() -> Set<String> {
    guard let text = defaults?.string(forKey: "hidden"), let data = text.data(using: .utf8), let list = try? JSONDecoder().decode([String].self, from: data) else {
      return []
    }
    return Set(list)
  }

  /// The freshest feed available: the server's when the cached one is old (or a push said so) and a token exists.
  static func load() async -> Feed? {
    let cached = cached()
    let stale = (defaults?.integer(forKey: "stale") ?? 0) == 1
    let age = cached.map { Date().timeIntervalSince1970 - $0.generatedAt / 1000 } ?? .infinity
    if let token = token(), stale || age > maxAge, let fresh = await fetch(token: token) {
      defaults?.removeObject(forKey: "stale")
      return fresh
    }
    return cached
  }

  static func fetch(token: String) async -> Feed? {
    var components = URLComponents(url: feedURL, resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "token", value: token), URLQueryItem(name: "days", value: "31")]
    guard let url = components.url else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = 12
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let feed = try? JSONDecoder().decode(Feed.self, from: data),
          let text = String(data: data, encoding: .utf8)
    else { return nil }
    defaults?.set(text, forKey: "feed")
    return feed
  }

  /// What the widget gallery and the Simulator show before the app has written anything.
  static var sample: Feed {
    let now = Date()
    let tz = TimeZone.current
    let today = DayKey.key(for: now, in: tz)
    let cal = DayKey.calendar(tz)
    func at(_ hour: Double, day: Int = 0) -> Double {
      let base = cal.date(byAdding: .day, value: day, to: cal.startOfDay(for: now))!
      return base.timeIntervalSince1970 * 1000 + hour * 3_600_000
    }
    func time(_ hour: Double) -> String {
      let h = Int(hour)
      let m = Int((hour - Double(h)) * 60)
      return String(format: "%d:%02d %@", h % 12 == 0 ? 12 : h % 12, m, h < 12 ? "AM" : "PM")
    }
    func task(_ id: String, _ owner: String, _ title: String, day: Int, hour: Double?, done: Bool = false) -> FeedItem {
      let key = DayKey.add(today, days: day)
      return FeedItem(
        id: "t\(id)", kind: "task", taskId: id, owner: owner, title: title, allDay: hour == nil, start: at(hour ?? 9, day: day),
        end: hour == nil ? at(24, day: day) : at(hour!, day: day) + 900_000, date: key, endDate: key, time: hour.map(time) ?? "all-day",
        completed: done, flagged: false, priority: 0, listId: "tasks", color: nil, calendar: nil
      )
    }
    func event(_ id: String, _ owner: String, _ title: String, day: Int, hour: Double?, hours: Double = 1, days: Int = 1, color: String? = nil) -> FeedItem {
      let first = DayKey.add(today, days: day)
      return FeedItem(
        id: "e\(id)", kind: color == nil ? "schedule" : "event", taskId: id, owner: owner, title: title, allDay: hour == nil,
        start: at(hour ?? 0, day: day), end: hour == nil ? at(0, day: day + days) : at(hour! + hours, day: day), date: first,
        endDate: DayKey.add(first, days: hour == nil ? days - 1 : 0), time: hour.map(time) ?? "all-day", completed: false, flagged: false,
        priority: 0, listId: nil, color: color, calendar: color == nil ? "gooya:schedules" : "sample:holidays"
      )
    }
    let items = [
      task("1", "gooya", "Gym", day: -1, hour: 7, done: true),
      event("2", "eunbi", "추석연휴", day: -3, hour: nil, days: 3, color: "#16a765"),
      task("3", "gooya", "Gym", day: 0, hour: 7),
      event("4", "gooya", "Lunch with Minho", day: 0, hour: 12),
      task("5", "eunbi", "Team standup", day: 0, hour: 10),
      task("6", "gooya", "Call 은비", day: 0, hour: 21),
      task("7", "gooya", "CS6750 lecture", day: 1, hour: 10),
      event("8", "eunbi", "Korean class", day: 1, hour: 19, hours: 1.5),
      task("9", "gooya", "Dentist", day: 2, hour: 14),
      task("10", "eunbi", "엄마 생신", day: 2, hour: nil),
      event("11", "gooya", "Family dinner", day: 4, hour: 18, hours: 2),
      task("12", "gooya", "Rent", day: 5, hour: nil),
      event("13", "eunbi", "Seoul trip", day: 8, hour: nil, days: 3, color: "#1badf8"),
      task("14", "eunbi", "Pack", day: 7, hour: 20),
      task("15", "gooya", "Oil change", day: 11, hour: 9),
    ]
    return Feed(
      generatedAt: now.timeIntervalSince1970 * 1000, me: "gooya", other: "eunbi", timezone: tz.identifier, today: today,
      people: [
        FeedPerson(key: "gooya", name: "구야", timezone: tz.identifier, colorLight: "#007aff", colorDark: "#0a84ff"),
        FeedPerson(key: "eunbi", name: "은비", timezone: "Asia/Seoul", colorLight: "#ff9500", colorDark: "#ff9f0a"),
      ],
      items: items.sorted { a, b in a.date != b.date ? a.date < b.date : a.allDay != b.allDay ? a.allDay : a.start < b.start },
      appUrl: nil
    )
  }
}

/// "YYYY-MM-DD" keys, as the app uses them.
enum DayKey {
  static func calendar(_ tz: TimeZone) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = tz
    return cal
  }
  static func key(for date: Date, in tz: TimeZone) -> String {
    let c = calendar(tz).dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }
  static func parts(_ key: String) -> (y: Int, m: Int, d: Int) {
    let p = key.split(separator: "-").compactMap { Int($0) }
    return p.count == 3 ? (p[0], p[1], p[2]) : (1970, 1, 1)
  }
  /// The key's midnight, as a floating date (UTC), for arithmetic that never crosses a DST change.
  static func floating(_ key: String) -> Date {
    let p = parts(key)
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal.date(from: DateComponents(year: p.y, month: p.m, day: p.d)) ?? Date(timeIntervalSince1970: 0)
  }
  static func add(_ key: String, days: Int) -> String {
    let d = floating(key).addingTimeInterval(Double(days) * 86_400)
    return self.key(for: d, in: TimeZone(identifier: "UTC")!)
  }
  /// 0 = Sunday.
  static func weekday(_ key: String) -> Int {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal.component(.weekday, from: floating(key)) - 1
  }
  /// The Sunday on or before the day.
  static func sunday(_ key: String) -> String { add(key, days: -weekday(key)) }
  static func daysInMonth(_ key: String) -> Int {
    let p = parts(key)
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let first = cal.date(from: DateComponents(year: p.y, month: p.m, day: 1))!
    return cal.range(of: .day, in: .month, for: first)?.count ?? 30
  }
  static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  static let monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
}
