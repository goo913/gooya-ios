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
 * GOOYA has three kinds of things:
 * - a task is a reminder: something to do, optionally on a date, optionally at a time (Apple Reminders semantics);
 * - a schedule is something happening at a time: lunch with a friend at noon, a flight, an appointment (like a
 *   calendar event; events imported from Google or iCloud are schedules too);
 * - a routine is a repeating background block of a person's days: work, sleep, the gym.
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
  /** Only its owner sees it (Share turned off). Shared is the default; older documents have no field. */
  private?: boolean
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

/**
 * A list of tasks. GOOYA's own lists (no `source`) are the categories both people share: a task is in one, a schedule
 * may be, and the category's colour is theirs (a task's ring, a schedule's fill). A person's Apple Reminders lists are
 * lists too (source 'apple-reminders', one person's): each stands for a category (`categoryId`) on that iPhone, so a
 * task in a category is a reminder in the list of that name, in the category's colour, in Reminders and Apple Calendar.
 */
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
  /**
   * 'apple-reminders' for a list that is one of a person's Reminders lists on their iPhone: its tasks are that person's
   * reminders, kept in step both ways. Unset for GOOYA's own lists, which both people share.
   */
  source?: 'apple-reminders'
  /** Whose Reminders list it is. */
  owner?: PersonKey
  /** The Reminders list's id on that iPhone (EventKit calendar identifier). */
  externalId?: string
  /** Reminders does not let apps change this list (a subscribed or shared-for-viewing list). */
  readOnly?: boolean
  /** The list new reminders go to on that iPhone. */
  isDefault?: boolean
  /**
   * A Reminders list's category: the GOOYA list it is on this person's iPhone. '' when it stands for none (its category
   * was deleted in GOOYA); not set until the server first links it (by name, or a category made from the list).
   */
  categoryId?: string
}

export const DEFAULT_LIST_ID = 'tasks'

/**
 * Something happening at a time, GOOYA's own: lunch with a friend at noon. It has a start and usually an end (an end
 * equal to the start means no end time), or it is all-day; it can repeat. It can be copied to the person's Google or
 * iCloud (the GOOYA calendar there) and changed there too. Imported calendar events work the same way (CalendarEvent).
 */
export interface Schedule {
  id: string
  owner: PersonKey
  createdBy: PersonKey
  title: string
  notes: string
  location: string
  allDay: boolean
  /** Instants (ms). All-day: local midnights in `timezone`, the end being the midnight after the last day. */
  start: number
  end: number
  startDate: DateKey
  /** The last day (inclusive). */
  endDate: DateKey
  timezone: string
  /** RRULE body without DTSTART. null = not repeating. */
  rrule: string | null
  exdates: DateKey[]
  overrides: Record<DateKey, EventOverride>
  /** Its category (a GOOYA list), or null. */
  categoryId?: string | null
  /** Its own colour, over the category's; null → the category's colour, or the owner's without a category. */
  color?: string | null
  /** Only its owner sees it (Share turned off). */
  private?: boolean
  createdAt: number
  updatedAt: number
}

export type RoutineKind = 'sleep' | 'work' | 'custom'

export interface RoutineOverride {
  title?: string
  startTime?: HHmm
  endTime?: HHmm
}

/** A repeating background block of a person's days (work, sleep): shown behind the day view, never copied out. */
export interface Routine {
  id: string
  owner: PersonKey
  title: string
  /** Emoji label, e.g. 💤 for sleep. */
  icon: string
  kind: RoutineKind
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
  overrides: Record<DateKey, RoutineOverride>
  /** Only its owner sees it (Share turned off). */
  private?: boolean
  createdAt: number
  updatedAt: number
}

export interface UserSettings {
  /** Show completed tasks everywhere (month, timeline, lists, search, widget). */
  showCompleted: boolean
  /** Show schedules and calendar events that have ended (month, timeline, list, widget). */
  showPastSchedules: boolean
  /** Routine band fill strength 0–1 (0.5 dark / 0.35 light by default). Stored as scheduleIntensity before routines had their name. */
  routineIntensity: number | null
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
  /** This person's order of the categories (ids; each person orders them their own way): categoriesInOrder. */
  categoryOrder: string[]
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
  /** The one device that syncs this person's Apple Reminders (two would each add GOOYA's new tasks to Reminders). */
  remindersDevice?: { id: string; name: string; at: number } | null
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

export interface RoutineOccurrence {
  kind: 'routine'
  routine: Routine
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
  showPastSchedules: true,
  routineIntensity: null,
  avoidDuplicates: true,
  secondGutter: false,
  notifyOnOtherAdds: true,
  defaultAlertTimed: null,
  defaultAlertAllDay: null,
  categoryOrder: [],
}

/**
 * What GOOYA does with one Google or iCloud calendar: nothing, show its events (import), or show them and let them be
 * changed in GOOYA with the changes going back (both). Copying GOOYA's own tasks and schedules out is per account
 * (exportTasks / exportSchedules), not per calendar; routines are never copied.
 */
export type SyncDirection = 'off' | 'import' | 'both'

export interface EventOverride {
  title?: string
  start?: number
  end?: number
  notes?: string
  location?: string
  cancelled?: boolean
}

/**
 * An imported calendar event (Google / Apple), or GOOYA's own schedule drawn as one (source 'gooya', see
 * shared/schedules.ts). Events have a start and end and are shown as blocks above routines. An imported one can be
 * changed only when its calendar is two-way.
 */
export interface CalendarEvent {
  id: string
  owner: PersonKey
  source: 'google' | 'apple' | 'gooya'
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
  /** Why the last change made in GOOYA could not be saved to the calendar (GOOYA shows the calendar's version again). */
  pushError?: string

  // What else the calendar says about an imported event, for its details (as Apple Calendar shows them). All optional:
  // events imported before these were read have none, and GOOYA's own schedules have none.
  /** The people invited, the organizer first (at most MAX_ATTENDEES; attendeeCount says how many there are). */
  attendees?: EventAttendee[]
  attendeeCount?: number
  organizer?: { email: string; name?: string; self?: boolean } | null
  /** The calendar owner's own answer to the invitation, when they are invited (not the organizer). */
  myStatus?: AttendeeStatus | null
  /** The video call: Google Meet, Zoom, Teams… (from the calendar's conference data, or a link in the event). */
  conference?: EventConference | null
  /** The event's own link (the URL field), when it has one. */
  url?: string
  /** Busy or free (Google's "Show as", iCloud's TRANSP). */
  showAs?: 'busy' | 'free'
  /** Alerts, in minutes before the start. */
  alerts?: number[]
  /** Files attached in Google Calendar (Drive links). */
  attachments?: { title: string; url: string }[]
  /** The event in the calendar's own website (Google Calendar), to open what GOOYA does not show. */
  htmlLink?: string
}

export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

export interface EventAttendee {
  email: string
  name?: string
  status: AttendeeStatus
  organizer?: boolean
  /** The calendar's owner. */
  self?: boolean
  optional?: boolean
}

export interface EventConference {
  /** "Google Meet", "Zoom", "Microsoft Teams", "Webex", "FaceTime", or the link's host. */
  name: string
  /** The link that joins the call. */
  url: string
  /** Dial-in entry points ("tel:+1-470-268-2442,,123456#"). */
  phones?: string[]
  /** Meeting ID, passcode or PIN, as the calendar gives them. */
  details?: string
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
