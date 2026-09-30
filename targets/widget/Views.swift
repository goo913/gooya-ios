import SwiftUI
import WidgetKit

// The Home Screen sizes and the Lock Screen ones. Small: today, or what is next. Medium: today's date and what is on
// now or next, beside the coming days. Large, by its Layout: this week and the next with what is on each day and the
// list under them (the default), the month with a dot per person and day and the list, or the month with what is on
// each day. Tasks, schedules and the events of connected calendars, never routines. An event over several days is on
// each of its days, never one bar across them. Every day shown opens that day in the app (gooya://day/YYYY-MM-DD).

struct WidgetRoot: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var systemScheme
  @Environment(\.widgetContentMargins) private var margins
  let entry: Entry

  var body: some View {
    // Appearance is for the Home Screen sizes; the Lock Screen tints its widgets itself.
    let home = [WidgetFamily.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge].contains(family)
    let appearance = home ? entry.appearance : .system
    let scheme: ColorScheme = appearance == .light ? .light : appearance == .dark ? .dark : systemScheme
    Group {
      if let feed = entry.feed {
        let m = WidgetModel(feed: feed, who: entry.who, now: entry.date, dark: scheme == .dark, hidden: entry.hidden)
        WidgetContent(m: m, family: family, layout: entry.layout, margins: margins)
      } else {
        NotSignedInView().padding(margins)
      }
    }
    .environment(\.colorScheme, scheme)
    .containerBackground(scheme == .dark ? Color.black : Color.white, for: .widget)
  }
}

/// A size's content, without the widget's background (the Mac preview, npm run widget:preview, draws it too).
struct WidgetContent: View {
  let m: WidgetModel
  let family: WidgetFamily
  let layout: WidgetLayout
  let margins: EdgeInsets

  /// The large layouts' grids use more of the widget than the standard margins leave.
  static let gridInsets = EdgeInsets(top: 13, leading: 11, bottom: 11, trailing: 11)

  var body: some View {
    switch family {
    case .systemSmall: SmallView(m: m).padding(margins)
    case .systemMedium: MediumView(m: m).padding(margins)
    case .systemLarge, .systemExtraLarge:
      switch layout {
      case .twoWeeks: TwoWeeksView(m: m).padding(WidgetContent.gridInsets)
      case .monthList: MonthListView(m: m).padding(margins)
      case .month: MonthView(m: m).padding(WidgetContent.gridInsets)
      }
    default:
      #if os(iOS)
      AccessoryRoot(m: m, family: family)
      #else
      SmallView(m: m)
      #endif
    }
  }
}

// MARK: - Pieces

/// A tappable area that opens a day in the app (on the Mac preview it is just its content).
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

/// A Reminders ring: empty while the task is open, with a dot once it is done.
struct Ring: View {
  let color: Color
  var done = false
  var size: CGFloat = 8
  var body: some View {
    ZStack {
      Circle().strokeBorder(color, lineWidth: max(1, size * 0.15))
      if done { Circle().fill(color).frame(width: size * 0.52, height: size * 0.52) }
    }
    .frame(width: size, height: size)
  }
}

/// What marks an item in a list: a ring for a task, a short bar in its colour for an event or schedule (as Apple's
/// Calendar widget marks events).
struct Marker: View {
  let m: WidgetModel
  let item: FeedItem
  var size: CGFloat = 8
  var body: some View {
    let color = Color(hex: m.hex(item))
    if item.isTask {
      Ring(color: color, done: item.completed, size: size)
    } else {
      RoundedRectangle(cornerRadius: 1.5, style: .continuous).fill(color).frame(width: 3, height: size + 4).frame(width: size)
    }
  }
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
    DayLink(key: m.listDay(item)) {
      HStack(spacing: 5) {
        Marker(m: m, item: item, size: size - 4)
        Text(item.title)
          .font(.system(size: size, weight: .medium))
          .lineLimit(1)
          .minimumScaleFactor(0.85)
        Spacer(minLength: 4)
        Text(item.allDay ? "all-day" : item.date < m.today ? m.dayLabel(item.date) : item.time)
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

/// The list by day: "TODAY", "TOMORROW", "THU 2", and the items under each.
struct DayList: View {
  let m: WidgetModel
  let groups: [DayGroup]
  var size: CGFloat = 12
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(groups) { g in
        Text(m.dayLabel(g.day).uppercased())
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(g.day == m.today ? Color.red : Color.secondary)
        ForEach(g.items) { item in ItemRow(m: m, item: item, size: size) }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The list filling the space it is given (a row is about 18 points, a day's heading three quarters of that).
struct FittedList: View {
  let m: WidgetModel
  var empty = "Nothing coming up"
  var body: some View {
    GeometryReader { geo in
      let groups = m.groups(from: m.upcoming, lines: Double((geo.size.height + 3) / 18.2))
      if groups.isEmpty {
        EmptyState(text: empty)
      } else {
        DayList(m: m, groups: groups)
      }
    }
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
            Marker(m: m, item: item, size: 7)
            VStack(alignment: .leading, spacing: -1) {
              Text(item.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
              Text(item.allDay ? "all-day" : m.listDay(item) == m.today ? item.time : "\(item.time) · \(m.dayLabel(item.date))")
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

/// Today's date and what is on now or next (as Apple's Up Next widget), beside the coming days.
struct MediumView: View {
  let m: WidgetModel
  var body: some View {
    let next = m.next
    let week = DayKey.add(m.today, days: 7)
    let rest = m.upcoming.filter { $0.id != next?.id && m.listDay($0) < week }
    let groups = m.groups(from: rest, lines: 6.6, heading: 0.7, perDay: 2)
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        DayLink(key: m.today) { DateHeader(m: m, big: true) }
        Spacer().frame(height: 6)
        if let next {
          NextUp(m: m, item: next)
        } else {
          Text("Nothing else today").font(.system(size: 11)).foregroundStyle(.tertiary)
        }
        Spacer(minLength: 0)
      }
      .frame(width: 110, alignment: .leading)

      if groups.isEmpty {
        EmptyState(text: "Nothing else this week")
      } else {
        VStack(alignment: .leading, spacing: 3) {
          ForEach(groups) { g in
            Text(m.dayLabel(g.day).uppercased())
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(g.day == m.today ? Color.red : Color.secondary)
            ForEach(g.items) { item in ItemRow(m: m, item: item, size: 11) }
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
    .widgetURL(WidgetModel.url(m.today))
  }
}

struct NextUp: View {
  let m: WidgetModel
  let item: FeedItem
  var body: some View {
    DayLink(key: m.today) {
      HStack(alignment: .top, spacing: 5) {
        Marker(m: m, item: item, size: 9).padding(.top, 2)
        VStack(alignment: .leading, spacing: 1) {
          Text(item.title).font(.system(size: 12, weight: .semibold)).lineLimit(2)
          Text(m.timeRange(item)).font(.system(size: 10)).foregroundStyle(m.overdue(item) ? Color.red : Color.secondary).lineLimit(1)
        }
      }
    }
  }
}

extension WidgetModel {
  /// "all-day", a task's time, or an event's "12:00 – 1:00 PM" (Apple's way of writing a range).
  func timeRange(_ item: FeedItem) -> String {
    if item.allDay { return "all-day" }
    if item.isTask || item.end <= item.start { return item.time }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = tz
    f.dateFormat = "a"
    let start = Date(timeIntervalSince1970: item.start / 1000)
    let end = Date(timeIntervalSince1970: item.end / 1000)
    let sameHalf = f.string(from: start) == f.string(from: end)
    f.dateFormat = sameHalf ? "h:mm" : "h:mm a"
    let from = f.string(from: start)
    f.dateFormat = "h:mm a"
    return "\(from) – \(f.string(from: end))"
  }
}

// MARK: - Large

/// The month's name, and whose calendar it is.
struct LargeHeader: View {
  let m: WidgetModel
  var body: some View {
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
  }
}

struct WeekdayLetters: View {
  private let letters = ["S", "M", "T", "W", "T", "F", "S"]
  var body: some View {
    HStack(spacing: 0) {
      ForEach(0..<7, id: \.self) { i in
        Text(letters[i]).font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary).frame(maxWidth: .infinity)
      }
    }
    .frame(height: 12)
  }
}

/// A day's number, in a red circle today; the 1st of a month says which ("Oct 1") where days of two months meet.
struct DayNumber: View {
  let m: WidgetModel
  let key: String
  let weekend: Bool
  var withMonth = false
  var body: some View {
    let isToday = key == m.today
    let p = DayKey.parts(key)
    Text(withMonth && p.d == 1 && !isToday ? "\(DayKey.monthShort[p.m - 1]) 1" : "\(p.d)")
      .font(.system(size: 11, weight: isToday || (withMonth && p.d == 1) ? .semibold : .regular))
      .foregroundStyle(isToday ? Color.white : weekend ? Color.secondary : Color.primary)
      .frame(minWidth: 16, minHeight: 16)
      .background(isToday ? Color.red : Color.clear, in: Circle())
  }
}

/// What is on a day, in its cell: a short bar the width of the day with the title clipped at its end (never "…"), as
/// the app's month view draws it. A task: a grey bar with a Reminders ring. An event or schedule: its colour's tint.
struct Chip: View {
  let m: WidgetModel
  let item: FeedItem
  static let height: CGFloat = 12
  var body: some View {
    let base = m.hex(item)
    let fill = item.isTask
      ? Color(hex: m.dark ? "#2c2c2e" : "#e9e9ee")
      : m.dark ? Color(hex: base, over: "#000000", amount: 0.27) : Color(hex: base, over: "#ffffff", amount: 0.2)
    let text: Color = item.isTask ? (item.completed ? Color.secondary : Color.primary) : Color(readable: base, dark: m.dark)
    HStack(spacing: 2.5) {
      if item.isTask { Ring(color: Color(hex: base), done: item.completed, size: 7) }
      Text(item.title)
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(text)
        .lineLimit(1)
        .fixedSize(horizontal: true, vertical: false)
    }
    .padding(.leading, item.isTask ? 2 : 3)
    // The title's width must not widen the day (minWidth 0): what does not fit is cut at the chip's end.
    .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
    .frame(height: Chip.height)
    .mask {
      HStack(spacing: 0) {
        Rectangle()
        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 6)
      }
    }
    .background(fill, in: RoundedRectangle(cornerRadius: 3.5, style: .continuous))
    .clipped()
  }
}

/// One day of the grid: its number, then as many chips as fit; when there are more, one fewer and "+3" in the last
/// place, as Apple Calendar does.
struct ItemsCell: View {
  let m: WidgetModel
  let key: String
  let weekend: Bool
  let slots: Int
  var withMonth = false
  var body: some View {
    let list = m.cell(key)
    let overflow = list.count > slots ? list.count - max(0, slots - 1) : 0
    let shown = overflow > 0 ? Array(list.prefix(max(0, slots - 1))) : list
    DayLink(key: key) {
      VStack(spacing: 1) {
        DayNumber(m: m, key: key, weekend: weekend, withMonth: withMonth)
          .padding(.bottom, 1)
        ForEach(shown) { item in Chip(m: m, item: item) }
        if overflow > 0 {
          Text("+\(overflow)")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 3)
            .frame(height: Chip.height)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 1)
      .padding(.top, 2)
      .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .contentShape(Rectangle())
    }
  }
}

/// How many chips fit under the day's number in a row this tall (the number takes 20 points with its padding).
func chipSlots(rowHeight: CGFloat) -> Int {
  max(1, Int((rowHeight - 20 + 1) / (Chip.height + 1)))
}

/// A thin line over each week, as in Apple Calendar's month.
struct WeekLine: View {
  var body: some View { Rectangle().fill(Color.secondary.opacity(0.28)).frame(height: 0.5) }
}

/// This week and the next with what is on each day, and the list of what is coming under them.
struct TwoWeeksView: View {
  let m: WidgetModel
  var body: some View {
    let start = DayKey.sunday(m.today)
    VStack(alignment: .leading, spacing: 0) {
      LargeHeader(m: m)
      Spacer().frame(height: 4)
      WeekdayLetters()
      ForEach(0..<2, id: \.self) { w in
        let week = DayKey.add(start, days: w * 7)
        VStack(spacing: 0) {
          WeekLine()
          HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { c in
              ItemsCell(m: m, key: DayKey.add(week, days: c), weekend: c == 0 || c == 6, slots: 3, withMonth: true)
            }
          }
        }
        .frame(height: 60)
      }
      WeekLine()
      Spacer().frame(height: 7)
      FittedList(m: m)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

/// The whole month, with what is on each day in its cell.
struct MonthView: View {
  let m: WidgetModel
  var body: some View {
    let p = DayKey.parts(m.today)
    let first = String(format: "%04d-%02d-01", p.y, p.m)
    let startCol = DayKey.weekday(first)
    let days = DayKey.daysInMonth(first)
    let rows = Int((Double(startCol + days) / 7).rounded(.up))
    VStack(alignment: .leading, spacing: 0) {
      LargeHeader(m: m)
      Spacer().frame(height: 4)
      WeekdayLetters()
      GeometryReader { geo in
        let rowHeight = geo.size.height / CGFloat(rows)
        let slots = chipSlots(rowHeight: rowHeight)
        VStack(spacing: 0) {
          ForEach(0..<rows, id: \.self) { r in
            VStack(spacing: 0) {
              WeekLine()
              HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { c in
                  let idx = r * 7 + c - startCol
                  if idx >= 0 && idx < days {
                    ItemsCell(m: m, key: String(format: "%04d-%02d-%02d", p.y, p.m, idx + 1), weekend: c == 0 || c == 6, slots: slots)
                  } else {
                    Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                  }
                }
              }
            }
            .frame(height: rowHeight)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

/// The month with a dot per person and day, and the list under it.
struct MonthListView: View {
  let m: WidgetModel
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      LargeHeader(m: m)
      MonthGrid(m: m)
      Spacer().frame(height: 2)
      FittedList(m: m)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(WidgetModel.url(m.today))
  }
}

struct MonthGrid: View {
  let m: WidgetModel

  var body: some View {
    let p = DayKey.parts(m.today)
    let first = String(format: "%04d-%02d-01", p.y, p.m)
    let startCol = DayKey.weekday(first)
    let days = DayKey.daysInMonth(first)
    let rows = Int((Double(startCol + days) / 7).rounded(.up))
    VStack(spacing: 1) {
      WeekdayLetters()
      ForEach(0..<rows, id: \.self) { r in
        HStack(spacing: 0) {
          ForEach(0..<7, id: \.self) { c in
            let idx = r * 7 + c - startCol
            if idx >= 0 && idx < days {
              DotsCell(m: m, key: String(format: "%04d-%02d-%02d", p.y, p.m, idx + 1), weekend: c == 0 || c == 6)
            } else {
              Color.clear.frame(maxWidth: .infinity).frame(height: 23)
            }
          }
        }
      }
    }
  }
}

struct DotsCell: View {
  let m: WidgetModel
  let key: String
  let weekend: Bool
  var body: some View {
    let owners = Array(m.dots(key).prefix(2))
    DayLink(key: key) {
      VStack(spacing: 1) {
        DayNumber(m: m, key: key, weekend: weekend)
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
      Text("\(next.title) · \(next.allDay ? m.dayLabel(m.listDay(next)) : m.listDay(next) == m.today ? next.time : m.dayLabel(next.date))")
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
