import SwiftUI
import WidgetKit

/// Draws from the App Group's copy of the calendar; entries at every time something on the widget ends, so past
/// items drop off without a reload, and at midnight. WidgetKit asks again after half an hour (then the server is
/// consulted when the app's copy is older than FeedStore.maxAge).
struct Provider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, feed: FeedStore.sample, who: "both") }

  func snapshot(for configuration: ShowIntent, in context: Context) async -> Entry {
    Entry(date: .now, feed: FeedStore.cached() ?? FeedStore.sample, who: configuration.who)
  }

  func timeline(for configuration: ShowIntent, in context: Context) async -> Timeline<Entry> {
    let feed = await FeedStore.load()
    let now = Date()
    var dates: Set<Date> = [now]
    if let feed {
      let tz = TimeZone(identifier: feed.timezone) ?? .current
      let cal = DayKey.calendar(tz)
      let tomorrow = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now.addingTimeInterval(86_400)
      let ends = (feed.items.map(\.end) + feed.schedules.map(\.end))
        .map { Date(timeIntervalSince1970: $0 / 1000) }
        .filter { $0 > now && $0 < tomorrow }
      for d in ends.sorted().prefix(16) { dates.insert(d) }
      dates.insert(tomorrow)
    }
    let entries = dates.sorted().map { Entry(date: $0, feed: feed, who: configuration.who) }
    return Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60)))
  }
}

struct GooyaWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "GOOYA", intent: ShowIntent.self, provider: Provider()) { entry in
      WidgetRoot(entry: entry)
        .containerBackground(Color(light: "#ffffff", dark: "#000000"), for: .widget)
    }
    .configurationDisplayName("GOOYA")
    .description("Today, what is coming up and the month, for both of you.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
  }
}

@main
struct GooyaWidgetBundle: WidgetBundle {
  var body: some Widget {
    GooyaWidget()
  }
}
