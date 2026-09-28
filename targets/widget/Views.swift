import SwiftUI
import WidgetKit

// The three Home Screen sizes and the Lock Screen ones. Small: today, or what is next. Medium: today's date and
// schedules on the left, the coming week's tasks on the right. Large: the month with a dot per person and day,
// then the next tasks. Every day shown opens that day in the app (gooya://day/YYYY-MM-DD).

struct WidgetRoot: View {
  @Environment(\.widgetFamily) private var family
  let entry: Entry

  var body: some View {
    if let feed = entry.feed {
      let model = WidgetModel(feed: feed, who: entry.who, now: entry.date)
      switch family {
      case .systemSmall: SmallView(m: model)
      case .systemMedium: MediumView(m: model)
      case .systemLarge, .systemExtraLarge: LargeView(m: model)
      default:
        #if os(iOS)
        AccessoryRoot(m: model, family: family)
        #else
        SmallView(m: model)
        #endif
      }
    } else {
      NotSignedInView()
    }
  }
}

// MARK: - Pieces

/// A tappable area that opens a day in the app (on the Mac preview, npm run widget:preview, it is just its content).
struct DayLink<Content: View>: View {
  let key: String
  @ViewBuilder let content: () -> Content
  var body: some View {
    #if os(iOS)
    Link(destination: WidgetModel.url(key)) { content() }
    #else
    content()
    #endif
  }
}

struct Dot: View {
  let color: Color
  var size: CGFloat = 8
  var body: some View { Circle().fill(color).frame(width: size, height: size) }
}

struct DateHeader: View {
  let m: WidgetModel
  var big = false
  var body: some View {
    VStack(alignment: .leading, spacing: -2) {
      Text(m.weekdayName.uppercased())
        .font(.system(size: big ? 13 : 11, weight: .semibold))
        .foregroundStyle(.red)
      Text("\(m.dayNumber)")
        .font(.system(size: big ? 36 : 30, weight: .bold))
        .foregroundStyle(.primary)
    }
    .widgetAccentable()
  }
}

struct ItemRow: View {
  let m: WidgetModel
  let item: FeedItem
  var size: CGFloat = 11
  var body: some View {
    DayLink(key: item.date) {
      HStack(spacing: 5) {
        Dot(color: m.color(item.owner), size: 7)
        Text(item.title)
          .font(.system(size: size, weight: .medium))
          .lineLimit(1)
          .minimumScaleFactor(0.85)
        Spacer(minLength: 4)
        Text(item.allDay ? "all-day" : item.time)
          .font(.system(size: size - 2))
          .foregroundStyle(m.overdue(item) ? Color.red : Color.secondary)
          .lineLimit(1)
          .layoutPriority(1)
      }
    }
  }
}

struct EmptyState: View {
  let text: String
  var body: some View {
    VStack {
      Spacer(minLength: 0)
      HStack {
        Spacer(minLength: 0)
        Text(text).font(.system(size: 12)).foregroundStyle(.tertiary).multilineTextAlignment(.center)
        Spacer(minLength: 0)
      }
      Spacer(minLength: 0)
    }
  }
}

struct DayGroup: Identifiable {
  let day: String
  let items: [FeedItem]
  var id: String { day }
}

extension WidgetModel {
  /// The coming week's tasks grouped by day, trimmed to what fits beside the date: about six and a half rows.
  func weekGroups(rows budget: Double = 6.5, todayLimit: Int = 3, otherLimit: Int = 2) -> [DayGroup] {
    var groups: [DayGroup] = []
    var rows = 0.0
    for offset in 0..<7 {
      let day = DayKey.add(today, days: offset)
      let items = day == today ? todays : open.filter { $0.date == day }
      if items.isEmpty { continue }
      if rows >= budget { break }
      rows += 0.7
      var kept: [FeedItem] = []
      for item in items.prefix(day == today ? todayLimit : otherLimit) {
        if rows >= budget { break }
        kept.append(item)
        rows += 1
      }
      if !kept.isEmpty { groups.append(DayGroup(day: day, items: kept)) }
    }
    return groups
  }
}

// MARK: - Small

struct SmallView: View {
  let m: WidgetModel
  var body: some View {
    let todays = m.todays
    let list = todays.isEmpty ? m.upcoming(from: DayKey.add(m.today, days: 1), limit: 3) : Array(todays.prefix(3))
    VStack(alignment: .leading, spacing: 4) {
      DateHeader(m: m)
      Spacer().frame(height: 2)
      if todays.isEmpty && !list.isEmpty {
        Text("UP NEXT").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
      }
      if list.isEmpty {
        EmptyState(text: "Nothing scheduled")
      } else {
        ForEach(list) { item in
          HStack(spacing: 5) {
            Dot(color: m.color(item.owner), size: 7)
            VStack(alignment: .leading, spacing: -1) {
              Text(item.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
              Text(item.allDay ? "all-day" : item.date == m.today ? item.time : "\(item.time) · \(m.dayLabel(item.date))")
                .font(.system(size: 10)).foregroundStyle(m.overdue(item) ? Color.red : Color.secondary).lineLimit(1)
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

// MARK: - Medium

struct MediumView: View {
  let m: WidgetModel
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        DayLink(key: m.today) { DateHeader(m: m, big: true) }
        Spacer().frame(height: 6)
        ForEach(m.schedules.prefix(3)) { s in
          DayLink(key: m.today) {
            HStack(spacing: 4) {
              Dot(color: m.color(s.owner), size: 6)
              VStack(alignment: .leading, spacing: -1) {
                Text("\(s.icon.map { "\($0) " } ?? "")\(s.title)\(m.who == "both" ? " · \(m.name(s.owner))" : "")")
                  .font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                Text(s.time).font(.system(size: 8)).foregroundStyle(.tertiary).lineLimit(1)
              }
            }
          }
          .padding(.bottom, 3)
        }
        Spacer(minLength: 0)
      }
      .frame(width: 110, alignment: .leading)

      let groups = m.weekGroups()
      VStack(alignment: .leading, spacing: 3) {
        if groups.isEmpty {
          EmptyState(text: "No upcoming tasks")
        } else {
          ForEach(groups) { g in
            Text(m.dayLabel(g.day).uppercased())
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(g.day == m.today ? Color.red : Color.secondary)
            ForEach(g.items) { item in ItemRow(m: m, item: item, size: 11) }
          }
          Spacer(minLength: 0)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .widgetURL(WidgetModel.url(m.today))
  }
}

// MARK: - Large

struct LargeView: View {
  let m: WidgetModel
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .center) {
        DayLink(key: m.today) {
          Text(m.monthTitle).font(.system(size: 16, weight: .bold)).widgetAccentable()
        }
        Spacer()
        HStack(spacing: 8) {
          ForEach(m.people, id: \.key) { p in
            HStack(spacing: 3) {
              Dot(color: m.color(p.key), size: 7)
              Text(p.name).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
            }
          }
        }
      }
      MonthGrid(m: m)
      Spacer().frame(height: 2)
      let list = m.upcoming(from: m.today, limit: 5)
      if list.isEmpty {
        EmptyState(text: "No upcoming tasks")
      } else {
        let days = Array(NSOrderedSet(array: list.map(\.date))) as? [String] ?? []
        ForEach(days, id: \.self) { day in
          Text(m.dayLabel(day).uppercased())
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(day == m.today ? Color.red : Color.secondary)
          ForEach(list.filter { $0.date == day }) { item in ItemRow(m: m, item: item, size: 12) }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

struct MonthGrid: View {
  let m: WidgetModel
  private let letters = ["S", "M", "T", "W", "T", "F", "S"]

  var body: some View {
    let p = DayKey.parts(m.today)
    let first = String(format: "%04d-%02d-01", p.y, p.m)
    let startCol = DayKey.weekday(first)
    let days = DayKey.daysInMonth(first)
    let rows = Int((Double(startCol + days) / 7).rounded(.up))
    VStack(spacing: 1) {
      HStack(spacing: 0) {
        ForEach(0..<7, id: \.self) { i in
          Text(letters[i]).font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary).frame(maxWidth: .infinity)
        }
      }
      ForEach(0..<rows, id: \.self) { r in
        HStack(spacing: 0) {
          ForEach(0..<7, id: \.self) { c in
            let idx = r * 7 + c - startCol
            if idx >= 0 && idx < days {
              DayCell(m: m, key: String(format: "%04d-%02d-%02d", p.y, p.m, idx + 1), weekend: c == 0 || c == 6)
            } else {
              Color.clear.frame(maxWidth: .infinity).frame(height: 23)
            }
          }
        }
      }
    }
  }
}

struct DayCell: View {
  let m: WidgetModel
  let key: String
  let weekend: Bool
  var body: some View {
    let isToday = key == m.today
    let owners = Array(m.dots(key).prefix(2))
    DayLink(key: key) {
      VStack(spacing: 1) {
        Text("\(DayKey.parts(key).d)")
          .font(.system(size: 11, weight: isToday ? .semibold : .regular))
          .foregroundStyle(isToday ? Color.white : weekend ? Color.secondary : Color.primary)
          .frame(width: 18, height: 18)
          .background(isToday ? Color.red : Color.clear, in: Circle())
        HStack(spacing: 2) {
          ForEach(owners, id: \.self) { o in Dot(color: m.color(o), size: 4) }
        }
        .frame(height: 4)
      }
      .frame(maxWidth: .infinity)
      .frame(height: 23)
    }
  }
}

// MARK: - Lock Screen

#if os(iOS)
struct AccessoryRoot: View {
  let m: WidgetModel
  let family: WidgetFamily
  var body: some View {
    switch family {
    case .accessoryRectangular: RectangularView(m: m)
    case .accessoryInline: InlineView(m: m)
    case .accessoryCircular: CircularView(m: m)
    default: SmallView(m: m)
    }
  }
}

struct RectangularView: View {
  let m: WidgetModel
  var body: some View {
    let list = Array((m.todays.isEmpty ? m.upcoming(from: DayKey.add(m.today, days: 1), limit: 2) : m.todays).prefix(2))
    VStack(alignment: .leading, spacing: 1) {
      Text("\(m.weekdayName) \(m.dayNumber)").font(.headline).widgetAccentable()
      if list.isEmpty {
        Text("Nothing scheduled").font(.caption).foregroundStyle(.secondary)
      } else {
        ForEach(list) { item in
          Text("\(item.title) · \(item.allDay ? "all-day" : item.time)").font(.caption).lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

struct InlineView: View {
  let m: WidgetModel
  var body: some View {
    if let next = m.todays.first ?? m.upcoming(from: DayKey.add(m.today, days: 1), limit: 1).first {
      Text("\(next.title) · \(next.allDay ? m.dayLabel(next.date) : next.date == m.today ? next.time : m.dayLabel(next.date))")
    } else {
      Text("Nothing scheduled")
    }
  }
}

struct CircularView: View {
  let m: WidgetModel
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: -2) {
        Text(m.weekdayName.uppercased()).font(.system(size: 10, weight: .semibold))
        Text("\(m.dayNumber)").font(.system(size: 22, weight: .bold))
      }
      .widgetAccentable()
    }
    .widgetURL(WidgetModel.url(m.today))
  }
}
#endif

// MARK: - Before sign-in

struct NotSignedInView: View {
  @Environment(\.widgetFamily) private var family
  private var tiny: Bool {
    #if os(iOS)
    return family == .accessoryInline || family == .accessoryCircular
    #else
    return false
    #endif
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("GOOYA").font(.system(size: 16, weight: .bold))
      Text(tiny ? "Open GOOYA" : "Open GOOYA and sign in to see your calendar here.")
        .font(.system(size: 12)).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(URL(string: "gooya://")!)
  }
}
