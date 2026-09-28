import type { PersonKey } from './people'

/** 'YYYY-MM-DD' */
export type DateKey = string
/** 'HH:mm' (24h) */
export type HHmm = string

export interface TaskOverride {
  title?: string
  notes?: string
  dueDate?: DateKey
  dueTime?: HHmm | null
}

export type Priority = 0 | 1 | 2 | 3

/**
 * A task is a reminder: something to do, optionally on a date, optionally at a
 * time (Apple Reminders semantics). Anything with a start and end is a schedule
 * or an imported event.
 */
export interface Task {
  id: string
  owner: PersonKey
  createdBy: PersonKey
  /** Shared list id ('tasks' is the default list). */
  listId: string
  title: string
  /** Notes, URLs are auto-detected and made tappable. */
  notes: string
  /** Date key in `timezone`, or null for an undated task. */
  dueDate: DateKey | null
  /** Wall-clock time in `timezone`, or null for a date-only task. */
  dueTime: HHmm | null
  /** IANA zone the due time is expressed in. */
  timezone: string
  /** RRULE body without DTSTART (date based). null = not repeating. */
  rrule: string | null
  exdates: DateKey[]
  overrides: Record<DateKey, TaskOverride>
  completed: boolean
  completedDates: DateKey[]
  /** Minutes before the due instant for extra alerts. The due-time alert is implicit. */
  earlyReminders: number[]
  tags: string[]
  flagged: boolean
  priority: Priority
  /** 'gooya' or an import source such as 'apple-reminders'. */
  source: string
  /** Mapping to external items (Google/Apple export, Reminders import). */
  externalRefs: ExternalRef[]
  createdAt: number
  updatedAt: number
}

export interface ExternalRef {
  source: 'google' | 'apple' | 'apple-reminders'
  accountId: string
  calendarId: string
  externalId: string
  etag?: string
  updatedAt?: number
}

export interface TaskList {
  id: string
  name: string
  /** Hex color. */
  color: string
  /** Icon name from the app's SF-style icon set. */
  icon: string
  order: number
  createdBy: PersonKey
  createdAt: number
  updatedAt: number
}

export const DEFAULT_LIST_ID = 'tasks'

export type ScheduleKind = 'sleep' | 'work' | 'custom'

export interface ScheduleOverride {
  title?: string
  startTime?: HHmm
  endTime?: HHmm
}

export interface Schedule {
  id: string
  owner: PersonKey
  title: string
  /** Emoji label, e.g. 💤 for sleep. */
  icon: string
  kind: ScheduleKind
  /** Hex color, or null → owner's color. */
  color: string | null
  startTime: HHmm
  /** endTime <= startTime means the block crosses midnight. */
  endTime: HHmm
  timezone: string
  /** RRULE body without DTSTART, e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'. */
  rrule: string
  startDate: DateKey
  /** Inclusive last date, or null for open-ended. */
  endDate: DateKey | null
  exdates: DateKey[]
  overrides: Record<DateKey, ScheduleOverride>
  createdAt: number
  updatedAt: number
}

export interface UserSettings {
  /** Show completed tasks everywhere (month, timeline, lists, search, widget). */
  showCompleted: boolean
  /** Schedule band fill strength 0–1 (0.5 dark / 0.35 light by default). */
  scheduleIntensity: number | null
  /** Hide the same external event arriving from two calendars. */
  avoidDuplicates: boolean
  /** Show the other person's local time as a second gutter in the timeline. */
  secondGutter: boolean
  /** Push me when the other person adds a task to my calendar. */
  notifyOnOtherAdds: boolean
  /** Default alert (minutes before) for new timed tasks; null = none. */
  defaultAlertTimed: number | null
  /** Default alert for new all-day tasks (minutes before 09:00); null = none. */
  defaultAlertAllDay: number | null
}

export interface UserDoc {
  key: PersonKey
  uid?: string
  email: string
  name: string
  timezone: string
  /** Hex color (legacy documents may hold a palette name). */
  color: string
  fcmTokens: string[]
  recentColors?: string[]
  settings: Partial<UserSettings>
  widgetToken?: string | null
}

export interface TaskOccurrence {
  kind: 'task'
  task: Task
  /** `${task.id}:${dateKey}` — stable identity of this occurrence. */
  key: string
  /** Original occurrence date key in the task's zone (identity for exdates/overrides/completedDates). */
  dateKey: DateKey
  isRecurring: boolean
  /** Effective due date (task zone). */
  dueDate: DateKey
  /** Effective due time or null (date-only). */
  dueTime: HHmm | null
  /** true when the task has no time. */
  allDay: boolean
  /** Due instant (ms): the wall-clock due time, or 09:00 local for date-only tasks. */
  start: number
  /** start + 15 min (timed) or the end of the day (date-only); kept for layout helpers. */
  end: number
  title: string
  notes: string
  completed: boolean
}

export interface ScheduleOccurrence {
  kind: 'schedule'
  schedule: Schedule
  key: string
  /** Occurrence date key in the owner's zone. */
  dateKey: DateKey
  start: number
  end: number
  title: string
  icon: string
}

export const DEFAULT_SETTINGS: UserSettings = {
  showCompleted: true,
  scheduleIntensity: null,
  avoidDuplicates: true,
  secondGutter: false,
  notifyOnOtherAdds: true,
  defaultAlertTimed: null,
  defaultAlertAllDay: null,
}

/** Direction of sync for one external calendar. */
export type SyncDirection = 'off' | 'import' | 'export' | 'both'

export interface EventOverride {
  title?: string
  start?: number
  end?: number
  cancelled?: boolean
}

/**
 * An imported calendar event (Google / Apple). Events have a start and end
 * and are shown as blocks above schedules. Editable only when the source
 * calendar is two-way.
 */
export interface CalendarEvent {
  id: string
  owner: PersonKey
  source: 'google' | 'apple'
  accountId: string
  calendarId: string
  calendarName: string
  externalId: string
  iCalUID: string
  title: string
  notes: string
  location: string
  allDay: boolean
  /** Instants (ms). All-day: local midnights in `timezone`. */
  start: number
  end: number
  startDate: DateKey
  endDate: DateKey
  timezone: string
  rrule: string | null
  exdates: DateKey[]
  overrides: Record<DateKey, EventOverride>
  /** Hex color of the source calendar. */
  color: string
  editable: boolean
  etag: string
  updatedAt: number
  /** Set by the client after a local edit; the sync function pushes it out and clears it. */
  dirty?: boolean
  /** Tombstone after a local delete on a two-way calendar. */
  deleted?: boolean
}

export interface EventOccurrence {
  kind: 'event'
  event: CalendarEvent
  key: string
  dateKey: DateKey
  isRecurring: boolean
  allDay: boolean
  start: number
  end: number
  startDate: DateKey
  endDate: DateKey
  title: string
}
