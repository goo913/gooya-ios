import EventKit
import ExpoModulesCore
import UIKit

/// Apple Reminders for GOOYA, straight from EventKit: the lists, the reminders in them, and saving GOOYA's changes back
/// (title, notes, due day and time, repeat, completed, priority, list), and the lists that are GOOYA's categories (made,
/// named and coloured as the categories are). A repeat is an RRULE body as GOOYA keeps it ("FREQ=WEEKLY;BYDAY=MO,WE"). Due days and times are the phone's clock as GOOYA keeps them ("2026-09-29",
/// "17:00"), so nothing is converted through instants on the way in or out.
public class GooyaRemindersModule: Module {
  private let store = EKEventStore()
  private var observer: NSObjectProtocol?
  /// The person allowed Reminders in this run of GOOYA. Until the app is opened again, iOS keeps answering "not
  /// determined" when asked for the status, though the store reads everything; without this, GOOYA said it could not
  /// read Reminders right after the person allowed it (and until they switched the permission off and on).
  private var allowedThisRun = false

  public func definition() -> ModuleDefinition {
    Name("GooyaReminders")

    /// Something changed in Reminders (in the Reminders app, from iCloud, or GOOYA's own save).
    Events("onChange")

    OnStartObserving {
      // Removed again in OnStopObserving, so holding the module here does not keep it alive.
      self.observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: self.store, queue: .main) { _ in
        self.sendEvent("onChange", [:])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }

    /// GOOYA running on a Mac: the Mac app (Mac Catalyst), or the iPhone app on an Apple silicon Mac.
    Function("isMac") { () -> Bool in
      ProcessInfo.processInfo.isMacCatalystApp || ProcessInfo.processInfo.isiOSAppOnMac
    }

    Function("authorization") { () -> String in
      let status = EKEventStore.authorizationStatus(for: .reminder)
      if status == .fullAccess || self.allowedThisRun {
        return "granted"
      }
      switch status {
      case .denied, .writeOnly: return "denied"
      case .restricted: return "restricted"
      default: return "undetermined"
      }
    }

    AsyncFunction("requestAccess") { (promise: Promise) in
      self.store.requestFullAccessToReminders { granted, error in
        if let error {
          promise.reject("ERR_REMINDERS_ACCESS", error.localizedDescription)
          return
        }
        self.allowedThisRun = granted
        // Lists and reminders read before access was given are empty; read them again.
        self.store.reset()
        promise.resolve(granted)
      }
    }

    AsyncFunction("lists") { () -> [[String: Any]] in
      let defaultId = self.store.defaultCalendarForNewReminders()?.calendarIdentifier
      return self.store.calendars(for: .reminder).map { Self.serialize($0, defaultId: defaultId) }
    }

    /// Makes a Reminders list (no id; in the account new reminders go to) or renames and recolours one: a GOOYA category
    /// as a list in Reminders. Returns the list as saved.
    AsyncFunction("saveList") { (input: ListInput) throws -> [String: Any] in
      let calendar: EKCalendar
      if let id = input.id {
        guard let found = self.store.calendar(withIdentifier: id) else {
          throw ListGoneException()
        }
        guard !found.isImmutable, !found.isSubscribed else {
          throw ReadOnlyListException(found.title)
        }
        calendar = found
      } else {
        guard let source = self.store.defaultCalendarForNewReminders()?.source ?? self.store.sources.first(where: { $0.sourceType == .local }) else {
          throw NoRemindersAccountException()
        }
        calendar = EKCalendar(for: .reminder, eventStore: self.store)
        calendar.source = source
        calendar.title = input.title ?? "GOOYA"
      }
      if let title = input.title, !title.isEmpty {
        calendar.title = title
      }
      if let color = input.color, let cg = Self.cgColor(color) {
        calendar.cgColor = cg
      }
      try self.store.saveCalendar(calendar, commit: true)
      return Self.serialize(calendar, defaultId: self.store.defaultCalendarForNewReminders()?.calendarIdentifier)
    }

    /// Open reminders, and those completed since `completedSince` (ms), in the given lists.
    AsyncFunction("reminders") { (listIds: [String], completedSince: Double, promise: Promise) in
      let calendars = self.store.calendars(for: .reminder).filter { listIds.contains($0.calendarIdentifier) }
      if calendars.isEmpty {
        promise.resolve([])
        return
      }
      let open = self.store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
      let done = self.store.predicateForCompletedReminders(withCompletionDateStarting: Date(timeIntervalSince1970: completedSince / 1000), ending: nil, calendars: calendars)
      self.store.fetchReminders(matching: open) { openReminders in
        self.store.fetchReminders(matching: done) { doneReminders in
          var seen = Set<String>()
          var out: [[String: Any]] = []
          for reminder in (openReminders ?? []) + (doneReminders ?? []) where seen.insert(reminder.calendarItemIdentifier).inserted {
            out.append(Self.serialize(reminder))
          }
          promise.resolve(out)
        }
      }
    }

    /// Makes a reminder (no id) or changes one. Only the fields given change; `setDue` says the due day/time is given
    /// (with `dueDate` null to clear it), `setRepeat` the repeat (`rrule` null: no repeat). Returns the reminder as Reminders keeps it, whose id may be new when it moved
    /// lists, and which for a repeating reminder marked done is its next time, not done.
    AsyncFunction("save") { (input: ReminderInput) throws -> [String: Any] in
      let reminder: EKReminder
      if let id = input.id {
        guard let found = self.store.calendarItem(withIdentifier: id) as? EKReminder else {
          throw ReminderGoneException()
        }
        reminder = found
      } else {
        guard let listId = input.listId, let calendar = self.store.calendar(withIdentifier: listId) else {
          throw ListGoneException()
        }
        reminder = EKReminder(eventStore: self.store)
        reminder.calendar = calendar
      }
      guard reminder.calendar.allowsContentModifications else {
        throw ReadOnlyListException(reminder.calendar.title)
      }
      if input.id != nil, let listId = input.listId, listId != reminder.calendar.calendarIdentifier {
        guard let calendar = self.store.calendar(withIdentifier: listId) else {
          throw ListGoneException()
        }
        guard calendar.allowsContentModifications else {
          throw ReadOnlyListException(calendar.title)
        }
        reminder.calendar = calendar
      }
      if let title = input.title {
        reminder.title = title
      }
      if let notes = input.notes {
        reminder.notes = notes.isEmpty ? nil : notes
      }
      if let priority = input.priority {
        reminder.priority = max(0, min(9, priority))
      }
      if input.setDue {
        Self.setDue(reminder, date: input.dueDate, time: input.dueTime, alarm: input.alarmAtDue)
      }
      if input.setRepeat {
        Self.setRepeat(reminder, input.rrule)
      }
      if let completed = input.completed {
        reminder.isCompleted = completed
      }
      try self.store.save(reminder, commit: true)
      // Read back what Reminders keeps rather than what was set. A repeating reminder saved as done is not done: at the
      // save, Reminders adds a done copy of that time (a new reminder, its own id, no repeat) and moves this one, same id,
      // to its next date after today, not done. GOOYA takes that state, not the done mark it asked for.
      _ = reminder.refresh()
      return Self.serialize(reminder)
    }

    AsyncFunction("remove") { (id: String) throws -> Bool in
      guard let reminder = self.store.calendarItem(withIdentifier: id) as? EKReminder else {
        return false
      }
      guard reminder.calendar.allowsContentModifications else {
        throw ReadOnlyListException(reminder.calendar.title)
      }
      try self.store.remove(reminder, commit: true)
      return true
    }
  }

  // MARK: - due dates

  /// The due day and time a reminder has, on this phone's clock ("2026-09-29", "17:00" or nil for a day only).
  static func due(of reminder: EKReminder) -> (date: String, time: String?)? {
    guard let components = reminder.dueDateComponents, let year = components.year, let month = components.month, let day = components.day else {
      return nil
    }
    guard components.hour != nil else {
      return (String(format: "%04d-%02d-%02d", year, month, day), nil)
    }
    // A time written in another zone (the reminder was made while travelling) is shown on this phone's clock.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = components.timeZone ?? reminder.timeZone ?? .current
    guard let instant = calendar.date(from: components) else {
      return (String(format: "%04d-%02d-%02d", year, month, day), String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0))
    }
    let local = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: instant)
    return (
      String(format: "%04d-%02d-%02d", local.year ?? year, local.month ?? month, local.day ?? day),
      String(format: "%02d:%02d", local.hour ?? 0, local.minute ?? 0)
    )
  }

  static func instant(of reminder: EKReminder) -> Date? {
    guard let components = reminder.dueDateComponents else {
      return nil
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = components.timeZone ?? reminder.timeZone ?? .current
    return calendar.date(from: components)
  }

  /// Sets the due day (and time) the way the Reminders app does, and keeps an alert that was at the old due time at
  /// the new one (Reminders alerts through an alarm at the due time).
  static func setDue(_ reminder: EKReminder, date: String?, time: String?, alarm: Bool) {
    let before = instant(of: reminder)
    guard let date, let day = parseDay(date) else {
      reminder.dueDateComponents = nil
      reminder.alarms?.filter { alarmAt($0, before) }.forEach { reminder.removeAlarm($0) }
      return
    }
    var components = DateComponents()
    components.calendar = Calendar(identifier: .gregorian)
    components.year = day.year
    components.month = day.month
    components.day = day.day
    if let time, let clock = parseTime(time) {
      components.hour = clock.hour
      components.minute = clock.minute
      components.timeZone = .current
    }
    reminder.timeZone = components.hour == nil ? nil : .current
    reminder.dueDateComponents = components
    let after = Calendar.current.date(from: components)
    let moved = reminder.alarms?.filter { alarmAt($0, before) } ?? []
    moved.forEach { reminder.removeAlarm($0) }
    if components.hour != nil, let after, !moved.isEmpty || alarm {
      reminder.addAlarm(EKAlarm(absoluteDate: after))
    }
  }

  static func alarmAt(_ alarm: EKAlarm, _ date: Date?) -> Bool {
    guard let date, let at = alarm.absoluteDate else {
      return false
    }
    return abs(at.timeIntervalSince(date)) < 60
  }

  static func parseDay(_ s: String) -> (year: Int, month: Int, day: Int)? {
    let parts = s.split(separator: "-").compactMap { Int($0) }
    return parts.count == 3 ? (parts[0], parts[1], parts[2]) : nil
  }

  static func parseTime(_ s: String) -> (hour: Int, minute: Int)? {
    let parts = s.split(separator: ":").compactMap { Int($0) }
    return parts.count >= 2 ? (parts[0], parts[1]) : nil
  }

  // MARK: - repeats

  /// RRULE's days, in EKWeekday's order (Sunday is 1).
  static let weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

  /// A reminder's repeat as an RRULE body, or nil when it does not repeat or repeats in a way GOOYA cannot write down.
  static func rrule(of reminder: EKReminder) -> String? {
    guard let rule = reminder.recurrenceRules?.first else {
      return nil
    }
    var parts: [String]
    switch rule.frequency {
    case .daily: parts = ["FREQ=DAILY"]
    case .weekly: parts = ["FREQ=WEEKLY"]
    case .monthly: parts = ["FREQ=MONTHLY"]
    case .yearly: parts = ["FREQ=YEARLY"]
    @unknown default: return nil
    }
    if rule.interval > 1 {
      parts.append("INTERVAL=\(rule.interval)")
    }
    if let days = rule.daysOfTheWeek, !days.isEmpty {
      let sorted = days.sorted { ($0.weekNumber, $0.dayOfTheWeek.rawValue) < ($1.weekNumber, $1.dayOfTheWeek.rawValue) }
      let codes = sorted.compactMap { day -> String? in
        let i = day.dayOfTheWeek.rawValue - 1
        guard weekdayCodes.indices.contains(i) else { return nil }
        return (day.weekNumber != 0 ? "\(day.weekNumber)" : "") + weekdayCodes[i]
      }
      parts.append("BYDAY=" + codes.joined(separator: ","))
    }
    let numbers = { (name: String, values: [NSNumber]?) in
      if let values, !values.isEmpty {
        parts.append("\(name)=" + values.map { "\($0.intValue)" }.joined(separator: ","))
      }
    }
    numbers("BYMONTHDAY", rule.daysOfTheMonth)
    numbers("BYMONTH", rule.monthsOfTheYear)
    numbers("BYWEEKNO", rule.weeksOfTheYear)
    numbers("BYYEARDAY", rule.daysOfTheYear)
    numbers("BYSETPOS", rule.setPositions)
    if let end = rule.recurrenceEnd {
      if let date = end.endDate {
        // The last day on this phone's calendar, as GOOYA writes an end ("UNTIL=20261231T235959Z").
        let day = Calendar.current.dateComponents([.year, .month, .day], from: date)
        parts.append(String(format: "UNTIL=%04d%02d%02dT235959Z", day.year ?? 0, day.month ?? 0, day.day ?? 0))
      } else if end.occurrenceCount > 0 {
        parts.append("COUNT=\(end.occurrenceCount)")
      }
    }
    return parts.joined(separator: ";")
  }

  /// An RRULE body as EventKit's repeat, or nil when it is not one.
  static func recurrenceRule(_ body: String) -> EKRecurrenceRule? {
    var fields: [String: String] = [:]
    for part in body.uppercased().split(separator: ";") {
      let pair = part.split(separator: "=", maxSplits: 1).map(String.init)
      if pair.count == 2 {
        fields[pair[0]] = pair[1]
      }
    }
    let frequency: EKRecurrenceFrequency
    switch fields["FREQ"] {
    case "DAILY": frequency = .daily
    case "WEEKLY": frequency = .weekly
    case "MONTHLY": frequency = .monthly
    case "YEARLY": frequency = .yearly
    default: return nil
    }
    let interval = max(1, Int(fields["INTERVAL"] ?? "") ?? 1)
    let days = (fields["BYDAY"] ?? "").split(separator: ",").compactMap { token -> EKRecurrenceDayOfWeek? in
      let code = String(token.suffix(2))
      guard let i = weekdayCodes.firstIndex(of: code), let weekday = EKWeekday(rawValue: i + 1) else { return nil }
      let week = Int(token.dropLast(2)) ?? 0
      return week == 0 ? EKRecurrenceDayOfWeek(weekday) : EKRecurrenceDayOfWeek(weekday, weekNumber: week)
    }
    let numbers = { (name: String) -> [NSNumber]? in
      let values = (fields[name] ?? "").split(separator: ",").compactMap { Int($0) }.map { NSNumber(value: $0) }
      return values.isEmpty ? nil : values
    }
    var end: EKRecurrenceEnd?
    if let until = fields["UNTIL"], until.count >= 8, let y = Int(until.prefix(4)), let m = Int(until.dropFirst(4).prefix(2)), let d = Int(until.dropFirst(6).prefix(2)) {
      // The end of that day on this phone's calendar.
      if let last = Calendar.current.date(from: DateComponents(year: y, month: m, day: d, hour: 23, minute: 59, second: 59)) {
        end = EKRecurrenceEnd(end: last)
      }
    } else if let count = Int(fields["COUNT"] ?? ""), count > 0 {
      end = EKRecurrenceEnd(occurrenceCount: count)
    }
    return EKRecurrenceRule(
      recurrenceWith: frequency,
      interval: interval,
      daysOfTheWeek: days.isEmpty ? nil : days,
      daysOfTheMonth: numbers("BYMONTHDAY"),
      monthsOfTheYear: numbers("BYMONTH"),
      weeksOfTheYear: numbers("BYWEEKNO"),
      daysOfTheYear: numbers("BYYEARDAY"),
      setPositions: numbers("BYSETPOS"),
      end: end
    )
  }

  /// Gives a reminder this repeat (an RRULE body), or none. A repeat needs a due date: without one it gets none.
  static func setRepeat(_ reminder: EKReminder, _ body: String?) {
    let rule = body.flatMap { $0.isEmpty ? nil : recurrenceRule($0) }
    for old in reminder.recurrenceRules ?? [] {
      reminder.removeRecurrenceRule(old)
    }
    if let rule, reminder.dueDateComponents != nil {
      reminder.addRecurrenceRule(rule)
    }
  }

  // MARK: - values for JavaScript

  static func serialize(_ calendar: EKCalendar, defaultId: String?) -> [String: Any] {
    [
      "id": calendar.calendarIdentifier,
      "title": calendar.title,
      "color": Self.hex(calendar.cgColor),
      "writable": calendar.allowsContentModifications,
      "editable": !calendar.isImmutable && !calendar.isSubscribed,
      "isDefault": calendar.calendarIdentifier == defaultId,
      "source": calendar.source?.title ?? "",
    ]
  }

  /// "#rrggbb" as a colour, or nil.
  static func cgColor(_ hex: String) -> CGColor? {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") {
      s.removeFirst()
    }
    guard s.count == 6, let v = UInt32(s, radix: 16) else {
      return nil
    }
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }

  static func serialize(_ reminder: EKReminder) -> [String: Any] {
    let due = due(of: reminder)
    return [
      "id": reminder.calendarItemIdentifier,
      "listId": reminder.calendar?.calendarIdentifier ?? "",
      "list": reminder.calendar?.title ?? "",
      "title": reminder.title ?? "",
      "notes": reminder.notes ?? "",
      "url": reminder.url?.absoluteString ?? "",
      "dueDate": due?.date ?? NSNull(),
      "dueTime": due?.time ?? NSNull(),
      "completed": reminder.isCompleted,
      "priority": reminder.priority,
      "recurring": reminder.hasRecurrenceRules,
      "rrule": rrule(of: reminder) ?? NSNull(),
      "alarms": (reminder.alarms ?? []).map { alarm -> [String: Any] in
        if let at = alarm.absoluteDate {
          return ["at": at.timeIntervalSince1970 * 1000]
        }
        return ["offset": alarm.relativeOffset]
      },
      "lastModified": (reminder.lastModifiedDate?.timeIntervalSince1970 ?? 0) * 1000,
    ]
  }

  static func hex(_ color: CGColor?) -> String {
    guard let color, let srgb = CGColorSpace(name: CGColorSpace.sRGB), let c = color.converted(to: srgb, intent: .defaultIntent, options: nil)?.components, c.count >= 3 else {
      return "#ff9500"
    }
    let byte = { (v: CGFloat) in Int((max(0, min(1, v)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(c[0]), byte(c[1]), byte(c[2]))
  }
}

struct ReminderInput: Record {
  @Field var id: String?
  @Field var listId: String?
  @Field var title: String?
  @Field var notes: String?
  @Field var setDue: Bool = false
  @Field var dueDate: String?
  @Field var dueTime: String?
  /// Add an alert at the due time (a reminder made in GOOYA, as the Reminders app does for a reminder with a time).
  @Field var alarmAtDue: Bool = false
  @Field var completed: Bool?
  @Field var priority: Int?
  /// Change the repeat to `rrule` (null: no repeat).
  @Field var setRepeat: Bool = false
  @Field var rrule: String?
}

struct ListInput: Record {
  @Field var id: String?
  @Field var title: String?
  /// "#rrggbb"
  @Field var color: String?
}

final class NoRemindersAccountException: Exception, @unchecked Sendable {
  override var reason: String {
    "This iPhone has no account for Reminders lists."
  }
}

final class ReminderGoneException: Exception, @unchecked Sendable {
  override var reason: String {
    "This reminder is no longer in Reminders."
  }
}

final class ListGoneException: Exception, @unchecked Sendable {
  override var reason: String {
    "This Reminders list is no longer on this iPhone."
  }
}

final class ReadOnlyListException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Reminders does not let apps change the list “\(param)”."
  }
}
