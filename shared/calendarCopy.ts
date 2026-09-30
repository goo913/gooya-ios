// GOOYA's tasks and schedules copied into a "GOOYA" calendar in Google or iCloud, and changes made to those copies
// coming back. The sync functions (functions/src/integrations) read the copies from Google or iCloud into the plain
// values below; the rules for what a change there means for GOOYA live here, so both calendars follow the same ones.

import type { DateKey, EventOverride, HHmm, Schedule, Task, TaskOverride } from './model'

/** One copy as it is in Google or iCloud now, on the clock of the task or routine it copies. */
export interface CalendarCopy {
  title: string
  notes: string
  allDay: boolean
  startDate: DateKey
  /** null for an all-day copy. */
  startTime: HHmm | null
  endTime: HHmm | null
  /** When it was last changed there (ms). */
  updated: number
}

/** A changed occurrence of a repeating copy: moved or renamed (copy), or deleted (cancelled). */
export interface CopyOccurrence {
  /** The day the occurrence was on before it changed. */
  dateKey: DateKey
  cancelled: boolean
  copy?: CalendarCopy
}

/** Whether GOOYA puts this task into the calendar (so its disappearing from there means someone deleted it there). */
export function taskIsCopied(t: Pick<Task, 'dueDate' | 'completed' | 'rrule'>): boolean {
  return !!t.dueDate && !(t.completed && !t.rrule)
}

/** Google Calendar keeps notes edited on its website as HTML; GOOYA's notes are plain text. */
export function plainNotes(s: string): string {
  if (!/<[a-z][\s\S]*>/i.test(s)) return s
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href: string, text: string) => (text && text !== href ? `${text} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The change to a task that a copy changed in the calendar amounts to, or null when there is none: the copy says what
 * GOOYA has, or GOOYA changed the task after the copy was changed (GOOYA's version then goes out again).
 */
export function taskChangeFromCopy(t: Task, c: CalendarCopy): Partial<Task> | null {
  if (c.updated <= t.updatedAt) return null
  const patch: Partial<Task> = {}
  const title = c.title.trim()
  if (title && title !== t.title) patch.title = title
  const notes = plainNotes(c.notes)
  if (notes !== (t.notes ?? '')) patch.notes = notes
  const dueTime = c.allDay ? null : c.startTime
  if (c.startDate !== t.dueDate || dueTime !== (t.dueDate ? t.dueTime : null)) {
    patch.dueDate = c.startDate
    patch.dueTime = dueTime
  }
  return Object.keys(patch).length ? patch : null
}

/** One occurrence of a repeating task changed in the calendar: deleted there, or moved or renamed. */
export function taskOccurrenceChange(t: Task, o: CopyOccurrence): Partial<Task> | null {
  if (o.cancelled) return t.exdates.includes(o.dateKey) ? null : { exdates: [...t.exdates, o.dateKey] }
  const c = o.copy
  if (!c || c.updated <= t.updatedAt) return null
  const before = t.overrides[o.dateKey] ?? {}
  const next: TaskOverride = { ...before }
  const title = c.title.trim()
  if (title && title !== (before.title ?? t.title)) next.title = title
  const dueTime = c.allDay ? null : c.startTime
  const wasDate = before.dueDate ?? o.dateKey
  const wasTime = before.dueTime !== undefined ? before.dueTime : t.dueTime
  if (c.startDate !== wasDate || dueTime !== wasTime) {
    next.dueDate = c.startDate
    next.dueTime = dueTime
  }
  if (JSON.stringify(next) === JSON.stringify(before)) return null
  return { overrides: { ...t.overrides, [o.dateKey]: next } }
}

/** A copy of a schedule as it is in Google or iCloud now: instants, and days on the schedule's clock. */
export interface ScheduleCopy {
  title: string
  notes: string
  location: string
  allDay: boolean
  start: number
  end: number
  startDate: DateKey
  endDate: DateKey
  /** When it was last changed there (ms). */
  updated: number
}

/** The change to a schedule that its copy, changed in the calendar, amounts to (null: none, or GOOYA's is newer). */
export function scheduleChangeFromCopy(s: Schedule, c: ScheduleCopy): Partial<Schedule> | null {
  if (c.updated <= s.updatedAt) return null
  const patch: Partial<Schedule> = {}
  const title = c.title.trim()
  if (title && title !== s.title) patch.title = title
  const notes = plainNotes(c.notes)
  if (notes !== (s.notes ?? '')) patch.notes = notes
  if (c.location !== (s.location ?? '')) patch.location = c.location
  const sameTimes = c.allDay === s.allDay && (c.allDay ? c.startDate === s.startDate && c.endDate === s.endDate : c.start === s.start && c.end === s.end)
  if (!sameTimes) Object.assign(patch, { allDay: c.allDay, start: c.start, end: Math.max(c.start, c.end), startDate: c.startDate, endDate: c.endDate })
  return Object.keys(patch).length ? patch : null
}

/** One occurrence of a repeating schedule changed in the calendar: deleted there, or moved or renamed. */
export function scheduleOccurrenceChange(s: Schedule, o: { dateKey: DateKey; cancelled: boolean; copy?: ScheduleCopy }): Partial<Schedule> | null {
  if (o.cancelled) {
    if (s.exdates.includes(o.dateKey)) return null
    const overrides = { ...s.overrides }
    delete overrides[o.dateKey]
    return { exdates: [...s.exdates, o.dateKey], overrides }
  }
  const c = o.copy
  if (!c || c.updated <= s.updatedAt) return null
  const before = s.overrides[o.dateKey] ?? {}
  const next: EventOverride = { ...before }
  const title = c.title.trim()
  if (title && title !== (before.title ?? s.title)) next.title = title
  const notes = plainNotes(c.notes)
  if (notes !== (before.notes ?? s.notes)) next.notes = notes
  if (c.location !== (before.location ?? s.location)) next.location = c.location
  if (c.start !== (before.start ?? null) || c.end !== (before.end ?? null)) {
    next.start = c.start
    next.end = Math.max(c.start, c.end)
  }
  if (JSON.stringify(next) === JSON.stringify(before)) return null
  return { overrides: { ...s.overrides, [o.dateKey]: next } }
}

/**
 * Whether a copy that disappeared from the calendar was deleted there by someone, rather than taken out by GOOYA
 * itself (a task completed, undated or deleted in GOOYA is taken out). A schedule GOOYA still has was deleted there.
 */
export function deletedInCalendar(item: Pick<Task, 'dueDate' | 'completed' | 'rrule'> | Schedule | null, kind: 'task' | 'schedule'): boolean {
  if (!item) return false
  return kind === 'schedule' ? true : taskIsCopied(item as Task)
}
