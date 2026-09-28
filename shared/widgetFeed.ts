import type { DateKey, Schedule, ScheduleOccurrence, Task, UserDoc } from './model'
import { PEOPLE, PERSON_KEYS, colorPair, otherPerson, type PersonKey } from './people'
import { expandSchedule, expandTask } from './recurrence'
import { DAY_MS, addDaysKey, keyInZone, startOfDayMs, todayKey } from './time'
import { formatTime12 } from './fmt'

/**
 * Schedule blocks worth showing on a "today" widget: occurrences that still overlap the rest of
 * today (from `now` to local midnight), one row per schedule. A cross-midnight block such as
 * Sleep 23:30–07:00 expands to two occurrences that touch today (last night's and tonight's);
 * only the earliest still-relevant one is kept so the widget never lists "Sleep" twice.
 */
export function todayScheduleOccurrences(schedules: Schedule[], dayStart: number, now: number): ScheduleOccurrence[] {
  const dayEnd = dayStart + DAY_MS
  const cutoff = Math.max(now, dayStart)
  const seen = new Set<string>()
  return schedules
    .flatMap((s) => expandSchedule(s, dayStart - DAY_MS, dayEnd))
    .filter((o) => o.end > cutoff && o.start < dayEnd)
    .sort((a, b) => a.start - b.start)
    .filter((o) => {
      if (seen.has(o.schedule.id)) return false
      seen.add(o.schedule.id)
      return true
    })
}

// ---------------------------------------------------------------------------------------------------------------
// The widget feed: what the Home Screen widget shows. Built by the phone app from its own data (and written to the
// App Group the widget reads) and by the widgetFeed Cloud Function (GET /widgetFeed?token=…), so both agree.

export interface WidgetPerson {
  key: PersonKey
  name: string
  timezone: string
  colorLight: string
  colorDark: string
}

export interface WidgetItem {
  /** Occurrence key (`${taskId}:${dateKey}`). */
  id: string
  taskId: string
  owner: PersonKey
  title: string
  allDay: boolean
  start: number
  end: number
  /** The day the item belongs to, in the feed owner's zone. */
  date: DateKey
  /** "all-day" or the due time, formatted in the feed owner's zone. */
  time: string
  completed: boolean
  flagged: boolean
  priority: number
  listId: string
}

export interface WidgetScheduleRow {
  id: string
  owner: PersonKey
  title: string
  icon: string
  kind: Schedule['kind']
  start: number
  end: number
  time: string
}

export interface WidgetFeed {
  generatedAt: number
  me: PersonKey
  other: PersonKey
  timezone: string
  today: DateKey
  people: WidgetPerson[]
  /** Open and (when shown) completed task occurrences from today on, soonest first, at most 60. */
  items: WidgetItem[]
  /** Today's schedule blocks that have not ended yet. */
  schedules: WidgetScheduleRow[]
  /** Which people have a task on each day around the current month (for the month grid's dots). */
  dots: Record<DateKey, PersonKey[]>
  appUrl: string
}

export interface WidgetFeedInput {
  me: UserDoc
  users: UserDoc[]
  tasks: Task[]
  schedules: Schedule[]
  /** How many days of items from today (1–31, default 14). */
  days?: number
  now?: number
  appUrl?: string
}

export function buildWidgetFeed({ me, users, tasks, schedules, days = 14, now = Date.now(), appUrl = 'https://gooya-eunbee.web.app' }: WidgetFeedInput): WidgetFeed {
  const span = Math.min(31, Math.max(1, days))
  const tz = me.timezone || PEOPLE[me.key].timezone
  const today = todayKey(tz, now)
  const rangeStart = startOfDayMs(today, tz)
  const rangeEnd = rangeStart + span * DAY_MS
  const monthStart = `${today.slice(0, 7)}-01` as DateKey
  const gridStart = startOfDayMs(monthStart, tz) - 7 * DAY_MS
  const gridEnd = startOfDayMs(addDaysKey(monthStart, 45), tz)

  const people: WidgetPerson[] = PERSON_KEYS.map((k) => {
    const u = users.find((x) => x.key === k)
    const color = colorPair(u?.color || PEOPLE[k].color, PEOPLE[k].color)
    return { key: k, name: u?.name || PEOPLE[k].name, timezone: u?.timezone || PEOPLE[k].timezone, colorLight: color.light, colorDark: color.dark }
  })

  const showCompleted = me.settings?.showCompleted !== false
  const items: WidgetItem[] = []
  const dots: Record<DateKey, PersonKey[]> = {}
  for (const t of tasks) {
    for (const occ of expandTask(t, Math.min(rangeStart, gridStart), Math.max(rangeEnd, gridEnd))) {
      if (!showCompleted && occ.completed) continue
      const day = occ.allDay ? occ.dueDate : keyInZone(occ.start, tz)
      if (!dots[day]) dots[day] = []
      if (!dots[day].includes(t.owner)) dots[day].push(t.owner)
      if (occ.end <= rangeStart || occ.start >= rangeEnd) continue
      items.push({
        id: occ.key,
        taskId: t.id,
        owner: t.owner,
        title: occ.title,
        allDay: occ.allDay,
        start: occ.start,
        end: occ.end,
        date: day,
        time: occ.allDay ? 'all-day' : formatTime12(occ.start, tz),
        completed: occ.completed,
        flagged: !!t.flagged,
        priority: t.priority ?? 0,
        listId: t.listId,
      })
    }
  }
  // By day; within a day the all-day items first, then by time.
  items.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1))

  const todaySchedules: WidgetScheduleRow[] = todayScheduleOccurrences(schedules, rangeStart, now).map((o) => ({
    id: o.key,
    owner: o.schedule.owner,
    title: o.title,
    icon: o.icon,
    kind: o.schedule.kind,
    start: o.start,
    end: o.end,
    time: `${formatTime12(o.start, tz)} – ${formatTime12(o.end, tz)}`,
  }))

  return {
    generatedAt: now,
    me: me.key,
    other: otherPerson(me.key),
    timezone: tz,
    today,
    people,
    items: items.slice(0, 60),
    schedules: todaySchedules,
    dots,
    appUrl,
  }
}
