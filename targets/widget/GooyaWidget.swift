import SwiftUI
import WidgetKit

/// Draws from the App Group's copy of the calendar; entries at every time something on the widget ends, so past
/// items drop off without a reload, and at midnight. WidgetKit asks again after half an hour (then the server is
/// consulted when the app's copy is older than FeedStore.maxAge).
struct Provider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, feed: FeedStore.sample, who: "both") }

  func snapshot(for configuration: ShowIntent, in context: Context) async -> Entry {
    entry(.now, FeedStore.cached() ?? FeedStore.sample, configuration)
  }

  func timeline(for configuration: ShowIntent, in context: Context) async -> Timeline<Entry> {
    let feed = await FeedStore.load()
    let now = Date()
    var dates: Set<Date> = [now]
    if let feed {
      let tz = TimeZone(identifier: feed.timezone) ?? .current
      let cal = DayKey.calendar(tz)
      let tomorrow = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now.addingTimeInterval(86_400)
      let ends = feed.items.map { Date(timeIntervalSince1970: $0.end / 1000) }.filter { $0 > now && $0 < tomorrow }
      for d in ends.sorted().prefix(16) { dates.insert(d) }
      dates.insert(tomorrow)
    }
    let entries = dates.sorted().map { entry($0, feed, configuration) }
    return Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60)))
  }

  private func entry(_ date: Date, _ feed: Feed?, _ configuration: ShowIntent) -> Entry {
    Entry(date: date, feed: feed, who: configuration.who, layout: configuration.layout, appearance: configuration.appearance, hidden: FeedStore.hidden())
  }
}

struct GooyaWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "GOOYA", intent: ShowIntent.self, provider: Provider()) { entry in
      WidgetRoot(entry: entry)
    }
    .configurationDisplayName("GOOYA")
    .description("Today, what is coming up, and two weeks or the month, for both of you.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    // The large layouts' grids use more of the widget than the standard margins; the other sizes put them back.
    .contentMarginsDisabled()
  }
}

@main
struct GooyaWidgetBundle: WidgetBundle {
  var body: some Widget {
    GooyaWidget()
  }
}
