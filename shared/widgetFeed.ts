import type { CalendarEvent, DateKey, Schedule, Task, TaskList, UserDoc } from './model'
import { PEOPLE, PERSON_KEYS, colorPair, otherPerson, type PersonKey } from './people'
import { dedupeEvents, eventDays, expandEvent, expandTask } from './recurrence'
import { scheduleAsEvent } from './schedules'
import { addDaysKey, keyInZone, startOfDayMs, todayKey } from './time'
import { formatTime12 } from './fmt'

// The widget feed: what the Home Screen widget shows. Built by the phone app from its own data (and written to the
// App Group the widget reads) and by the widgetFeed Cloud Function (GET /widgetFeed?token=…), so both agree.
// Tasks, schedules and the events of connected calendars; never routines (sleep, work), which are background.

export interface WidgetPerson {
  key: PersonKey
  name: string
  timezone: string
  colorLight: string
  colorDark: string
}

export type WidgetItemKind = 'task' | 'schedule' | 'event'

export interface WidgetItem {
  /** Occurrence key (`${id}:${dateKey}`). */
  id: string
  kind: WidgetItemKind
  /** The task's, schedule's or event's id (named for the widgets of builds before schedules existed). */
  taskId: string
  owner: PersonKey
  title: string
  allDay: boolean
  start: number
  end: number
  /** The first and the last day it is on, in the feed owner's zone (the same day for all but multi-day events). */
  date: DateKey
  endDate: DateKey
  /** "all-day" or the start time, formatted in the feed owner's zone. */
  time: string
  completed: boolean
  flagged: boolean
  priority: number
  listId: string
  /**
   * An event's calendar colour; a task's list colour (the widget uses it when it shows one person, as the app does);
   * null for a schedule, which is in its owner's colour.
   */
  color: string | null
  /** The calendar an event or schedule is in ("accountId:calendarId", "gooya:schedules"), for calendars hidden on the phone. */
  calendar: string | null
}

export interface WidgetFeed {
  version: 3
  generatedAt: number
  me: PersonKey
  other: PersonKey
  timezone: string
  today: DateKey
  people: WidgetPerson[]
  /** The days the items cover: from `from` (a Sunday) up to, not including, `to`. */
  from: DateKey
  to: DateKey
  /** Everything on those days, by day; within a day, all-day first, then by time. */
  items: WidgetItem[]
  /** Which people have something on each day (the month grid's dots). */
  dots: Record<DateKey, PersonKey[]>
  /** Read by the widgets of builds before schedules existed (which showed routines); always empty. */
  schedules: never[]
  appUrl: string
}

export interface WidgetFeedInput {
  me: UserDoc
  users: UserDoc[]
  tasks: Task[]
  schedules: Schedule[]
  /** Events of connected calendars (both people's). */
  events: CalendarEvent[]
  lists: TaskList[]
  /** How many days of items from today (1–42, default 31). */
  days?: number
  now?: number
  appUrl?: string
}

/** At most this many items, the furthest days dropped first (the App Group copy stays small). */
const MAX_ITEMS = 700

/** "#rrggbb" from "#rgb", "#rrggbb" or "#rrggbbaa" (iCloud's calendar colours carry an alpha); null otherwise. */
export function hex6(c: string | null | undefined): string | null {
  if (!c) return null
  const s = c.trim()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return s.slice(0, 7).toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase()
  return null
}

/** The Sunday on or before a day. */
function sundayOf(key: DateKey): DateKey {
  const [y, m, d] = key.split('-').map(Number)
  return addDaysKey(key, -new Date(Date.UTC(y, m - 1, d)).getUTCDay())
}

export function buildWidgetFeed({ me, users, tasks, schedules, events, lists, days = 31, now = Date.now(), appUrl = 'https://gooya-eunbee.web.app' }: WidgetFeedInput): WidgetFeed {
  const span = Math.min(42, Math.max(1, days))
  const tz = me.timezone || PEOPLE[me.key].timezone
  const today = todayKey(tz, now)
  // The month grid (from the Sunday before the 1st, six weeks), this week and the next, and the list's days ahead.
  const monthGrid = sundayOf(`${today.slice(0, 7)}-01` as DateKey)
  const thisWeek = sundayOf(today)
  const from = monthGrid < thisWeek ? monthGrid : thisWeek
  const ends = [addDaysKey(monthGrid, 42), addDaysKey(thisWeek, 14), addDaysKey(today, span)].sort()
  const to = ends[ends.length - 1]
  const rangeStart = startOfDayMs(from, tz)
  const rangeEnd = startOfDayMs(to, tz)

  const people: WidgetPerson[] = PERSON_KEYS.map((k) => {
    const u = users.find((x) => x.key === k)
    const color = colorPair(u?.color || PEOPLE[k].color, PEOPLE[k].color)
    return { key: k, name: u?.name || PEOPLE[k].name, timezone: u?.timezone || PEOPLE[k].timezone, colorLight: color.light, colorDark: color.dark }
  })

  const showCompleted = me.settings?.showCompleted !== false
  const listColor = new Map(lists.map((l) => [l.id, hex6(l.color)]))
  const items: WidgetItem[] = []

  for (const t of tasks) {
    for (const occ of expandTask(t, rangeStart, rangeEnd)) {
      if (!showCompleted && occ.completed) continue
      const day = occ.allDay ? occ.dueDate : keyInZone(occ.start, tz)
      if (day < from || day >= to) continue
      items.push({
        id: occ.key,
        kind: 'task',
        taskId: t.id,
        owner: t.owner,
        title: occ.title,
        allDay: occ.allDay,
        start: occ.start,
        end: occ.end,
        date: day,
        endDate: day,
        time: occ.allDay ? 'all-day' : formatTime12(occ.start, tz),
        completed: occ.completed,
        flagged: !!t.flagged,
        priority: t.priority ?? 0,
        listId: t.listId,
        color: listColor.get(t.listId) ?? null,
        calendar: null,
      })
    }
  }

  // Google first when the same event comes from two calendars, as the app orders them.
  const imported = events.filter((e) => !e.deleted).sort((a, b) => (a.source === b.source ? 0 : a.source === 'google' ? -1 : 1))
  const eventList = [
    ...(me.settings?.avoidDuplicates === false ? imported : dedupeEvents(imported)).map((e) => ({ e, kind: 'event' as const })),
    ...schedules.map((s) => ({ e: scheduleAsEvent(s, ''), kind: 'schedule' as const })),
  ]
  for (const { e, kind } of eventList) {
    for (const occ of expandEvent(e, rangeStart, rangeEnd)) {
      const covered = eventDays(occ, tz)
      const first = covered[0]
      const last = covered[covered.length - 1]
      if (!first || last < from || first >= to) continue
      items.push({
        id: occ.key,
        kind,
        taskId: e.id,
        owner: e.owner,
        title: occ.title,
        allDay: occ.allDay,
        start: occ.start,
        end: occ.end,
        date: first,
        endDate: last,
        time: occ.allDay ? 'all-day' : formatTime12(occ.start, tz),
        completed: false,
        flagged: false,
        priority: 0,
        listId: '',
        color: kind === 'event' ? hex6(e.color) : null,
        calendar: kind === 'event' ? `${e.accountId}:${e.calendarId}` : 'gooya:schedules',
      })
    }
  }

  // By day; within a day the all-day items first, then by time.
  items.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start || a.title.localeCompare(b.title)))
  const kept = items.slice(0, MAX_ITEMS)

  const dots: Record<DateKey, PersonKey[]> = {}
  for (const it of kept) {
    let day = it.date
    for (let guard = 0; day <= it.endDate && guard < 62; guard++, day = addDaysKey(day, 1)) {
      if (!dots[day]) dots[day] = []
      if (!dots[day].includes(it.owner)) dots[day].push(it.owner)
    }
  }

  return {
    version: 3,
    generatedAt: now,
    me: me.key,
    other: otherPerson(me.key),
    timezone: tz,
    today,
    people,
    from,
    to,
    items: kept,
    dots,
    schedules: [],
    appUrl,
  }
}

