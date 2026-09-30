// Plain-object normalisers shared by the web app and Cloud Functions.
import type { CalendarEvent, ExternalRef, Schedule, Task, TaskList, UserDoc } from './model'
import { isPersonKey } from './people'
import { fieldsInZone } from './time'

type Data = Record<string, unknown>

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'toMillis' in v) return (v as { toMillis: () => number }).toMillis()
  return fallback
}
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const obj = <T>(v: unknown): T => (v && typeof v === 'object' ? (v as T) : ({} as T))

const PRIORITY = (v: unknown): 0 | 1 | 2 | 3 => (v === 1 || v === 2 || v === 3 ? v : 0)

/** Accepts both the round-2 shape and the original start/end shape (migrated on read). */
export function normalizeTask(id: string, d: Data): Task {
  const timezone = str(d.timezone, 'UTC')
  let dueDate: string | null = typeof d.dueDate === 'string' && d.dueDate ? d.dueDate : null
  let dueTime: string | null = typeof d.dueTime === 'string' && d.dueTime ? d.dueTime : null
  if (dueDate === null && (typeof d.start === 'number' || typeof d.startDate === 'string')) {
    // Legacy task: derive the due date/time from the old start instant.
    const allDay = !!d.allDay
    const startDate = str(d.startDate)
    if (allDay && startDate) {
      dueDate = startDate
      dueTime = null
    } else if (typeof d.start === 'number') {
      const f = fieldsInZone(d.start, timezone)
      dueDate = `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`
      dueTime = `${String(f.h).padStart(2, '0')}:${String(f.min).padStart(2, '0')}`
    }
  }
  const legacyAlerts = arr<number>(d.alerts).filter((a) => typeof a === 'number' && a > 0)
  const early = Array.isArray(d.earlyReminders) ? arr<number>(d.earlyReminders).filter((a) => typeof a === 'number' && a > 0) : legacyAlerts
  let notes = str(d.notes)
  if (!('dueDate' in d)) {
    const extras = [str(d.location), str(d.url)].filter(Boolean)
    if (extras.length) notes = [notes, ...extras].filter(Boolean).join('\n')
  }
  return {
    id,
    owner: isPersonKey(d.owner) ? d.owner : 'gooya',
    createdBy: isPersonKey(d.createdBy) ? d.createdBy : 'gooya',
    listId: str(d.listId, 'tasks') || 'tasks',
    title: str(d.title),
    notes,
    dueDate,
    dueTime,
    timezone,
    rrule: typeof d.rrule === 'string' && d.rrule ? d.rrule : null,
    exdates: arr<string>(d.exdates),
    overrides: obj(d.overrides),
    completed: !!d.completed,
    completedDates: arr<string>(d.completedDates),
    earlyReminders: early,
    tags: arr<string>(d.tags).filter((t) => typeof t === 'string'),
    flagged: !!d.flagged,
    priority: PRIORITY(d.priority),
    source: str(d.source, 'gooya') || 'gooya',
    externalRefs: arr<ExternalRef>(d.externalRefs),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  }
}

export function normalizeList(id: string, d: Data): TaskList {
  return {
    id,
    name: str(d.name, 'Tasks'),
    color: str(d.color, '#0091ff'),
    icon: str(d.icon, 'list'),
    order: num(d.order),
    createdBy: isPersonKey(d.createdBy) ? d.createdBy : 'gooya',
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
    ...(d.source === 'apple-reminders'
      ? { source: 'apple-reminders' as const, owner: isPersonKey(d.owner) ? d.owner : undefined, externalId: str(d.externalId), readOnly: !!d.readOnly, isDefault: !!d.isDefault }
      : {}),
  }
}

export function normalizeSchedule(id: string, d: Data): Schedule {
  return {
    id,
    owner: isPersonKey(d.owner) ? d.owner : 'gooya',
    title: str(d.title),
    icon: str(d.icon),
    kind: d.kind === 'sleep' || d.kind === 'work' ? d.kind : 'custom',
    color: typeof d.color === 'string' && d.color ? d.color : null,
    startTime: str(d.startTime, '09:00'),
    endTime: str(d.endTime, '17:00'),
    timezone: str(d.timezone, 'UTC'),
    rrule: str(d.rrule, 'FREQ=DAILY'),
    startDate: str(d.startDate),
    endDate: typeof d.endDate === 'string' && d.endDate ? d.endDate : null,
    exdates: arr<string>(d.exdates),
    overrides: obj(d.overrides),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  }
}

export function normalizeUser(id: string, d: Data): UserDoc | null {
  if (!isPersonKey(id)) return null
  return {
    key: id,
    uid: str(d.uid) || undefined,
    email: str(d.email),
    name: str(d.name),
    timezone: str(d.timezone),
    color: str(d.color),
    fcmTokens: arr<string>(d.fcmTokens),
    recentColors: arr<string>(d.recentColors),
    settings: obj(d.settings),
    widgetToken: typeof d.widgetToken === 'string' ? d.widgetToken : null,
  }
}

export function normalizeEvent(id: string, d: Data): CalendarEvent {
  return {
    id,
    owner: isPersonKey(d.owner) ? d.owner : 'gooya',
    source: d.source === 'apple' ? 'apple' : 'google',
    accountId: str(d.accountId),
    calendarId: str(d.calendarId),
    calendarName: str(d.calendarName),
    externalId: str(d.externalId),
    iCalUID: str(d.iCalUID),
    title: str(d.title, '(No title)'),
    notes: str(d.notes),
    location: str(d.location),
    allDay: !!d.allDay,
    start: num(d.start),
    end: num(d.end),
    startDate: str(d.startDate),
    endDate: str(d.endDate, str(d.startDate)),
    timezone: str(d.timezone, 'UTC'),
    rrule: typeof d.rrule === 'string' && d.rrule ? d.rrule : null,
    exdates: arr<string>(d.exdates),
    overrides: obj(d.overrides),
    color: str(d.color, '#8e8e93'),
    editable: !!d.editable,
    etag: str(d.etag),
    updatedAt: num(d.updatedAt),
    dirty: !!d.dirty,
    deleted: !!d.deleted,
    ...(typeof d.pushError === 'string' && d.pushError ? { pushError: d.pushError } : {}),
  }
}
