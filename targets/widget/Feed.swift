import Foundation

// The feed the app writes into the App Group (shared/widgetFeed.ts builds it; src/lib/widget.ts stores it) and the
// widgetFeed Cloud Function serves. Field names follow the TypeScript types in shared/widgetFeed.ts.

struct FeedPerson: Codable, Hashable {
  let key: String
  let name: String
  let timezone: String
  let colorLight: String
  let colorDark: String
}

struct FeedItem: Codable, Identifiable, Hashable {
  let id: String
  let taskId: String
  let owner: String
  let title: String
  let allDay: Bool
  let start: Double
  let end: Double
  let date: String
  let time: String
  let completed: Bool
  let flagged: Bool?
  let priority: Int?
  let listId: String?
}

struct FeedSchedule: Codable, Identifiable, Hashable {
  let id: String
  let owner: String
  let title: String
  let icon: String?
  let kind: String?
  let start: Double
  let end: Double
  let time: String
}

struct Feed: Codable, Hashable {
  let generatedAt: Double
  let me: String
  let other: String
  let timezone: String
  let today: String
  let people: [FeedPerson]
  let items: [FeedItem]
  let schedules: [FeedSchedule]
  let dots: [String: [String]]
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
    func at(_ hour: Int, day: Int = 0) -> Double {
      let base = cal.date(byAdding: .day, value: day, to: cal.startOfDay(for: now))!
      return cal.date(byAdding: .hour, value: hour, to: base)!.timeIntervalSince1970 * 1000
    }
    let tomorrow = DayKey.add(today, days: 1)
    let dayAfter = DayKey.add(today, days: 2)
    return Feed(
      generatedAt: now.timeIntervalSince1970 * 1000, me: "gooya", other: "eunbi", timezone: tz.identifier, today: today,
      people: [
        FeedPerson(key: "gooya", name: "구야", timezone: tz.identifier, colorLight: "#007aff", colorDark: "#0a84ff"),
        FeedPerson(key: "eunbi", name: "은비", timezone: "Asia/Seoul", colorLight: "#ff9500", colorDark: "#ff9f0a"),
      ],
      items: [
        FeedItem(id: "1", taskId: "1", owner: "gooya", title: "Gym", allDay: false, start: at(7), end: at(7) + 900_000, date: today, time: "7:00 AM", completed: false, flagged: false, priority: 0, listId: "tasks"),
        FeedItem(id: "2", taskId: "2", owner: "eunbi", title: "Team standup", allDay: false, start: at(10), end: at(10) + 900_000, date: today, time: "10:00 AM", completed: false, flagged: false, priority: 0, listId: "tasks"),
        FeedItem(id: "3", taskId: "3", owner: "gooya", title: "Call 은비", allDay: false, start: at(21), end: at(21) + 900_000, date: today, time: "9:00 PM", completed: false, flagged: true, priority: 0, listId: "tasks"),
        FeedItem(id: "4", taskId: "4", owner: "gooya", title: "CS6750 lecture", allDay: false, start: at(10, day: 1), end: at(10, day: 1) + 900_000, date: tomorrow, time: "10:00 AM", completed: false, flagged: false, priority: 0, listId: "tasks"),
        FeedItem(id: "5", taskId: "5", owner: "eunbi", title: "Korean class", allDay: false, start: at(19, day: 1), end: at(19, day: 1) + 900_000, date: tomorrow, time: "7:00 PM", completed: false, flagged: false, priority: 0, listId: "tasks"),
        FeedItem(id: "6", taskId: "6", owner: "gooya", title: "Dentist", allDay: false, start: at(14, day: 2), end: at(14, day: 2) + 900_000, date: dayAfter, time: "2:00 PM", completed: false, flagged: false, priority: 2, listId: "tasks"),
        FeedItem(id: "7", taskId: "7", owner: "eunbi", title: "엄마 생신", allDay: true, start: at(0, day: 2), end: at(24, day: 2), date: dayAfter, time: "all-day", completed: false, flagged: true, priority: 0, listId: "tasks"),
      ],
      schedules: [
        FeedSchedule(id: "s1", owner: "gooya", title: "Work", icon: "💼", kind: "work", start: at(9), end: at(17), time: "9:00 AM – 5:00 PM"),
        FeedSchedule(id: "s2", owner: "eunbi", title: "Sleep", icon: "💤", kind: "sleep", start: at(11), end: at(19), time: "11:00 AM – 7:00 PM"),
      ],
      dots: [today: ["gooya", "eunbi"], tomorrow: ["gooya", "eunbi"], dayAfter: ["gooya", "eunbi"], DayKey.add(today, days: 4): ["gooya"], DayKey.add(today, days: 9): ["eunbi"]],
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
  static func daysInMonth(_ key: String) -> Int {
    let p = parts(key)
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let first = cal.date(from: DateComponents(year: p.y, month: p.m, day: 1))!
    return cal.range(of: .day, in: .month, for: first)?.count ?? 30
  }
  static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
}
