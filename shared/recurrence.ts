import * as rrulePkg from 'rrule'

// rrule ships a UMD `main`; under Node/tsx the namespace only exposes `default`.
const RRule: typeof rrulePkg.RRule =
  (rrulePkg as unknown as { RRule?: typeof rrulePkg.RRule }).RRule ??
  (rrulePkg as unknown as { default: { RRule: typeof rrulePkg.RRule } }).default.RRule
export type RRuleType = InstanceType<typeof RRule>
import type { CalendarEvent, DateKey, EventOccurrence, HHmm, Routine, RoutineOccurrence, Task, TaskOccurrence } from './model'
import { DAY_MS, addDaysKey, fieldsInZone, floatingFromKey, floatingInZone, keyFromFloating, keyInZone, minutesOf, startOfDayMs, zonedMs } from './time'

const ruleCache = new Map<string, RRuleType>()

/** Build an RRule from a rule body and a floating DTSTART. */
export function buildRule(body: string, dtstart: Date, until?: Date | null): RRuleType {
  const cacheKey = `${body}|${dtstart.getTime()}|${until ? until.getTime() : ''}`
  const cached = ruleCache.get(cacheKey)
  if (cached) return cached
  const parsed = RRule.parseString(body)
  const rule = new RRule({ ...parsed, dtstart, until: until ?? parsed.until ?? null })
  if (ruleCache.size > 500) ruleCache.clear()
  ruleCache.set(cacheKey, rule)
  return rule
}

/** Human description in Apple's wording. */
export function describeRule(body: string | null): string {
  if (!body) return 'Never'
  const o = RRule.parseString(body)
  const interval = o.interval ?? 1
  const byday = (o.byweekday as unknown as Array<{ weekday: number }> | undefined) ?? undefined
  switch (o.freq) {
    case RRule.DAILY:
      return interval === 1 ? 'Every Day' : `Every ${interval} Days`
    case RRule.WEEKLY: {
      if (byday && byday.length) {
        const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        const days = byday.map((d) => names[d.weekday]).join(', ')
        const isWeekdays = byday.length === 5 && byday.every((d) => d.weekday <= 4)
        if (isWeekdays && interval === 1) return 'Every Weekday'
        return interval === 1 ? `Weekly on ${days}` : `Every ${interval} Weeks on ${days}`
      }
      return interval === 1 ? 'Every Week' : interval === 2 ? 'Every 2 Weeks' : `Every ${interval} Weeks`
    }
    case RRule.MONTHLY:
      return interval === 1 ? 'Every Month' : `Every ${interval} Months`
    case RRule.YEARLY:
      return interval === 1 ? 'Every Year' : `Every ${interval} Years`
    default:
      return 'Custom'
  }
}

function occurrenceKey(taskId: string, dateKey: DateKey): string {
  return `${taskId}:${dateKey}`
}

/** Time at which date-only tasks alert / are placed. */
export const DATE_ONLY_TIME: HHmm = '09:00'

/**
 * Expand a task (reminder) into occurrences whose due instant falls inside
 * [rangeStart, rangeEnd) (ms). Undated tasks never expand.
 */
export function expandTask(task: Task, rangeStart: number, rangeEnd: number): TaskOccurrence[] {
  const tz = task.timezone || 'UTC'
  const out: TaskOccurrence[] = []
  if (!task.dueDate) return out

  const push = (dateKey: DateKey, baseDate: DateKey, baseTime: HHmm | null) => {
    if (task.exdates?.includes(dateKey)) return
    const ov = task.overrides?.[dateKey]
    const dueDate = ov?.dueDate ?? baseDate
    const dueTime = ov && 'dueTime' in ov ? (ov.dueTime ?? null) : baseTime
    const start = zonedMs(dueDate, dueTime ?? DATE_ONLY_TIME, tz)
    const end = dueTime ? start + 15 * 60_000 : startOfDayMs(addDaysKey(dueDate, 1), tz)
    // Date-only tasks belong to their whole day; timed tasks to their instant.
    const dayStart = startOfDayMs(dueDate, tz)
    const visibleStart = dueTime ? start : dayStart
    if (end <= rangeStart || visibleStart >= rangeEnd) return
    const isRecurring = !!task.rrule
    out.push({
      kind: 'task',
      task,
      key: occurrenceKey(task.id, dateKey),
      dateKey,
      isRecurring,
      dueDate,
      dueTime,
      allDay: !dueTime,
      start,
      end,
      title: ov?.title ?? task.title,
      notes: ov?.notes ?? task.notes,
      completed: isRecurring ? (task.completedDates?.includes(dateKey) ?? false) : !!task.completed,
    })
  }

  if (!task.rrule) {
    push(task.dueDate, task.dueDate, task.dueTime)
    return out
  }
  const rule = buildRule(task.rrule, floatingFromKey(task.dueDate))
  const lo = new Date(floatingInZone(rangeStart, tz).getTime() - 2 * DAY_MS)
  const hi = new Date(floatingInZone(rangeEnd, tz).getTime() + 2 * DAY_MS)
  for (const occ of rule.between(lo, hi, true)) {
    const dateKey = keyFromFloating(occ)
    push(dateKey, dateKey, task.dueTime)
  }
  return out
}

/** Expand a routine into instants overlapping [rangeStart, rangeEnd). */
export function expandRoutine(routine: Routine, rangeStart: number, rangeEnd: number): RoutineOccurrence[] {
  const tz = routine.timezone || 'UTC'
  const out: RoutineOccurrence[] = []
  const until = routine.endDate ? floatingFromKey(routine.endDate, '23:59') : null
  const rule = buildRule(routine.rrule || 'FREQ=DAILY', floatingFromKey(routine.startDate), until)
  const lo = new Date(floatingInZone(rangeStart, tz).getTime() - 2 * DAY_MS)
  const hi = new Date(floatingInZone(rangeEnd, tz).getTime() + DAY_MS)
  for (const occ of rule.between(lo, hi, true)) {
    const dateKey = keyFromFloating(occ)
    if (routine.exdates?.includes(dateKey)) continue
    const ov = routine.overrides?.[dateKey]
    const startTime = ov?.startTime ?? routine.startTime
    const endTime = ov?.endTime ?? routine.endTime
    const start = zonedMs(dateKey, startTime, tz)
    let end = zonedMs(dateKey, endTime, tz)
    if (minutesOf(endTime) <= minutesOf(startTime)) end = zonedMs(addDaysKey(dateKey, 1), endTime, tz)
    if (end <= rangeStart || start >= rangeEnd) continue
    out.push({
      kind: 'routine',
      routine,
      key: `${routine.id}:${dateKey}`,
      dateKey,
      start,
      end,
      title: ov?.title ?? routine.title,
      icon: routine.icon,
    })
  }
  return out
}

/** Split an occurrence [start,end) into per-day segments on the viewer's zone. */
export function splitByDay<T extends { start: number; end: number }>(
  occ: T,
  viewerTz: string,
): Array<{ dateKey: DateKey; start: number; end: number; startMin: number; endMin: number; occ: T }> {
  const segments: Array<{ dateKey: DateKey; start: number; end: number; startMin: number; endMin: number; occ: T }> = []
  // A moment (a schedule without an end time) is on the day it is at.
  if (occ.end <= occ.start) {
    const dateKey = keyInZone(occ.start, viewerTz)
    const dayStart = startOfDayMs(dateKey, viewerTz)
    const dayLength = (startOfDayMs(addDaysKey(dateKey, 1), viewerTz) - dayStart) / 60_000
    const min = Math.round(((occ.start - dayStart) / 60_000) * (1440 / dayLength))
    return [{ dateKey, start: occ.start, end: occ.start, startMin: min, endMin: min, occ }]
  }
  let cursor = occ.start
  let guard = 0
  while (cursor < occ.end && guard++ < 62) {
    const dateKey = keyInZone(cursor, viewerTz)
    const dayStart = startOfDayMs(dateKey, viewerTz)
    const nextDayStart = startOfDayMs(addDaysKey(dateKey, 1), viewerTz)
    const segStart = Math.max(cursor, dayStart)
    const segEnd = Math.min(occ.end, nextDayStart)
    const dayLength = (nextDayStart - dayStart) / 60_000
    segments.push({
      dateKey,
      start: segStart,
      end: segEnd,
      startMin: Math.round(((segStart - dayStart) / 60_000) * (1440 / dayLength)),
      endMin: Math.round(((segEnd - dayStart) / 60_000) * (1440 / dayLength)),
      occ,
    })
    cursor = nextDayStart
  }
  return segments
}

/** A task's occurrence by its own day (`dateKey`, on the task's clock: an alert's, a link's), or null. */
export function taskOccurrenceOn(task: Task, dateKey: DateKey): TaskOccurrence | null {
  const tz = task.timezone || 'UTC'
  return expandTask(task, startOfDayMs(dateKey, tz) - DAY_MS, startOfDayMs(addDaysKey(dateKey, 1), tz) + DAY_MS).find((o) => o.dateKey === dateKey) ?? null
}

/** Date key (viewer zone) a task occurrence appears on: its own date when date-only, else the local date of the due instant. */
export function occurrenceDays(occ: TaskOccurrence, viewerTz: string): DateKey[] {
  return [occ.allDay ? occ.dueDate : keyInZone(occ.start, viewerTz)]
}

export interface RuleFields {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'other'
  interval: number
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  until: string | null
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Parse an RRULE body into simple fields (rrule weekdays are 0 = Monday). */
export function parseRuleFields(body: string | null): RuleFields {
  if (!body) return { freq: 'other', interval: 1, weekdays: [], until: null }
  const o = RRule.parseString(body)
  const freq =
    o.freq === RRule.DAILY ? 'daily' : o.freq === RRule.WEEKLY ? 'weekly' : o.freq === RRule.MONTHLY ? 'monthly' : o.freq === RRule.YEARLY ? 'yearly' : 'other'
  const raw = (o.byweekday as unknown as Array<{ weekday: number } | number> | undefined) ?? []
  const weekdays = raw.map((d) => ((typeof d === 'number' ? d : d.weekday) + 1) % 7).sort()
  const until = o.until ? keyFromFloating(o.until) : null
  return { freq, interval: o.interval ?? 1, weekdays, until }
}

/** Build an RRULE body from fields. */
export function buildRuleBody(f: { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval?: number; weekdays?: number[]; until?: string | null }): string {
  const parts = [`FREQ=${f.freq.toUpperCase()}`]
  if (f.interval && f.interval > 1) parts.push(`INTERVAL=${f.interval}`)
  if (f.freq === 'weekly' && f.weekdays && f.weekdays.length) parts.push(`BYDAY=${[...f.weekdays].sort().map((d) => BYDAY[d]).join(',')}`)
  if (f.until) {
    const y = f.until.slice(0, 4)
    const m = f.until.slice(5, 7)
    const d = f.until.slice(8, 10)
    parts.push(`UNTIL=${y}${m}${d}T235959Z`)
  }
  return parts.join(';')
}

/** Return the rule body with UNTIL set to the end of `untilKey` (or removed when null). */
export function withUntil(body: string, untilKey: string | null): string {
  const f = parseRuleFields(body)
  const freq = f.freq === 'other' ? 'weekly' : f.freq
  return buildRuleBody({ freq, interval: f.interval, weekdays: f.weekdays, until: untilKey })
}

/** Reminders-style repeat presets → RRULE bodies. */
export const REPEAT_PRESETS: Array<{ key: string; label: string; rrule: string | null }> = [
  { key: 'never', label: 'Never', rrule: null },
  { key: 'daily', label: 'Daily', rrule: 'FREQ=DAILY' },
  { key: 'weekdays', label: 'Weekdays', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { key: 'weekends', label: 'Weekends', rrule: 'FREQ=WEEKLY;BYDAY=SU,SA' },
  { key: 'weekly', label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { key: 'biweekly', label: 'Biweekly', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { key: 'monthly', label: 'Monthly', rrule: 'FREQ=MONTHLY' },
  { key: 'quarterly', label: 'Every 3 Months', rrule: 'FREQ=MONTHLY;INTERVAL=3' },
  { key: 'halfyear', label: 'Every 6 Months', rrule: 'FREQ=MONTHLY;INTERVAL=6' },
  { key: 'yearly', label: 'Yearly', rrule: 'FREQ=YEARLY' },
]

/** Preset key for a rule body, or 'custom'. */
export function repeatPresetKey(body: string | null): string {
  if (!body) return 'never'
  const norm = (b: string) => b.split(';').filter((p) => !p.startsWith('UNTIL')).sort().join(';')
  const found = REPEAT_PRESETS.find((p) => p.rrule && norm(p.rrule) === norm(body))
  return found ? found.key : 'custom'
}

/** Expand an imported event into occurrences overlapping [rangeStart, rangeEnd). */
export function expandEvent(ev: CalendarEvent, rangeStart: number, rangeEnd: number): EventOccurrence[] {
  const tz = ev.timezone || 'UTC'
  const out: EventOccurrence[] = []
  const push = (dateKey: DateKey, baseStart: number, baseEnd: number) => {
    if (ev.exdates?.includes(dateKey)) return
    const ov = ev.overrides?.[dateKey]
    if (ov?.cancelled) return
    const start = ov?.start ?? baseStart
    const end = ov?.end ?? (ov?.start != null ? ov.start + (baseEnd - baseStart) : baseEnd)
    if (end <= rangeStart || start >= rangeEnd) return
    out.push({
      kind: 'event',
      event: ev,
      key: `${ev.id}:${dateKey}`,
      dateKey,
      isRecurring: !!ev.rrule,
      allDay: ev.allDay,
      start,
      end,
      startDate: ev.allDay ? keyInZone(start + 12 * 3600_000, tz) : keyInZone(start, tz),
      endDate: ev.allDay ? keyInZone(end - 12 * 3600_000, tz) : keyInZone(Math.max(start, end - 1), tz),
      title: ov?.title ?? ev.title,
    })
  }
  if (!ev.rrule) {
    push(ev.startDate, ev.start, ev.end)
    return out
  }
  const duration = Math.max(0, ev.end - ev.start)
  if (ev.allDay) {
    const rule = buildRule(ev.rrule, floatingFromKey(ev.startDate))
    const lo = new Date(floatingInZone(rangeStart, tz).getTime() - duration - DAY_MS)
    const hi = new Date(floatingInZone(rangeEnd, tz).getTime() + DAY_MS)
    for (const occ of rule.between(lo, hi, true)) {
      const dateKey = keyFromFloating(occ)
      const s = startOfDayMs(dateKey, tz)
      push(dateKey, s, s + duration)
    }
    return out
  }
  const f = fieldsInZone(ev.start, tz)
  const wall = `${String(f.h).padStart(2, '0')}:${String(f.min).padStart(2, '0')}`
  const rule = buildRule(ev.rrule, floatingFromKey(ev.startDate, wall))
  const lo = new Date(floatingInZone(rangeStart, tz).getTime() - duration - DAY_MS)
  const hi = new Date(floatingInZone(rangeEnd, tz).getTime() + DAY_MS)
  for (const occ of rule.between(lo, hi, true)) {
    const dateKey = keyFromFloating(occ)
    const s = zonedMs(dateKey, wall, tz)
    push(dateKey, s, s + duration)
  }
  return out
}

/** Viewer-local days an event occurrence spans (for the month grid). */
export function eventDays(occ: EventOccurrence, viewerTz: string): DateKey[] {
  const first = occ.allDay ? occ.startDate : keyInZone(occ.start, viewerTz)
  const last = occ.allDay ? occ.endDate : keyInZone(Math.max(occ.start, occ.end - 1), viewerTz)
  const days: DateKey[] = []
  let k = first
  let guard = 0
  while (k <= last && guard++ < 62) {
    days.push(k)
    k = addDaysKey(k, 1)
  }
  return days
}

/**
 * Drop duplicates that arrive from two sources: same iCalUID, or the same
 * title + start + end. The first event wins (callers pass a stable order).
 */
export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>()
  const out: CalendarEvent[] = []
  for (const ev of events) {
    if (ev.deleted) continue
    const keys = [ev.iCalUID ? `uid:${ev.iCalUID.toLowerCase()}` : '', `sig:${ev.title.trim().toLowerCase()}|${ev.start}|${ev.end}`].filter(Boolean)
    if (keys.some((k) => seen.has(k))) continue
    for (const k of keys) seen.add(k)
    out.push(ev)
  }
  return out
}
