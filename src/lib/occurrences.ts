import { useMemo } from 'react'
import { useData } from '@/store/data'
import { usePrefs } from '@/store/prefs'
import type { PersonKey } from '@shared/people'
import type { DateKey, EventOccurrence, RoutineOccurrence, TaskOccurrence } from '@shared/model'
import { dedupeEvents, eventDays, expandEvent, expandRoutine, expandTask, occurrenceDays } from '@shared/recurrence'
import { scheduleAsEvent } from '@shared/schedules'
import { useShallow } from 'zustand/react/shallow'
import { useIsDark } from '@/theme'
import { scheduleHex, useMe, usePerson } from './people'
import { useNow, viewerTz } from './useNow'
import { keyInZone } from '@shared/time'

export function sortOccurrences(a: TaskOccurrence, b: TaskOccurrence): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  if (a.start !== b.start) return a.start - b.start
  return a.title.localeCompare(b.title)
}

/** All task occurrences for people within [start, end) ms. */
export function useTaskOccurrences(start: number, end: number, people: PersonKey[]): TaskOccurrence[] {
  const tasks = useData(useShallow((s) => s.tasks.filter((t) => people.includes(t.owner))))
  const showCompleted = useShowCompleted()
  return useMemo(() => {
    const out: TaskOccurrence[] = []
    for (const t of tasks) out.push(...expandTask(t, start, end))
    const filtered = showCompleted ? out : out.filter((o) => !o.completed)
    filtered.sort(sortOccurrences)
    return filtered
  }, [tasks, start, end, showCompleted])
}

/** Settings → Show Completed Tasks (default on). */
export function useShowCompleted(): boolean {
  const me = useMe()
  return usePerson(me).settings.showCompleted
}

/** Task occurrences grouped by the viewer-local date they appear on. */
export function useTasksByDay(start: number, end: number, people: PersonKey[], viewerTz: string): Map<DateKey, TaskOccurrence[]> {
  const occ = useTaskOccurrences(start, end, people)
  return useMemo(() => {
    const map = new Map<DateKey, TaskOccurrence[]>()
    for (const o of occ) {
      for (const day of occurrenceDays(o, viewerTz)) {
        let list = map.get(day)
        if (!list) map.set(day, (list = []))
        list.push(o)
      }
    }
    return map
  }, [occ, viewerTz])
}

export function useRoutineOccurrences(start: number, end: number, people: PersonKey[]): RoutineOccurrence[] {
  const routines = useData(useShallow((s) => s.routines.filter((t) => people.includes(t.owner))))
  return useMemo(() => {
    const out: RoutineOccurrence[] = []
    for (const s of routines) out.push(...expandRoutine(s, start, end))
    out.sort((a, b) => a.start - b.start)
    return out
  }, [routines, start, end])
}

/** Whether an occurrence has ended: an all-day one after its last day, a timed one at its end (or start). */
export function isPast(o: Pick<EventOccurrence, 'allDay' | 'start' | 'end' | 'endDate'>, now: number, today: string): boolean {
  return o.allDay ? o.endDate < today : Math.max(o.start, o.end) <= now
}

/**
 * Schedules for people within [start, end): GOOYA's own (in their own colour, their category's, or their owner's) and
 * the events of imported calendars (in their calendar's colour, deduped when the setting is on). Settings → Show Past
 * Schedules off leaves out those that have ended.
 */
export function useEventOccurrences(start: number, end: number, people: PersonKey[]): EventOccurrence[] {
  const hidden = usePrefs((s) => s.hiddenCalendars)
  const events = useData(useShallow((s) => s.events.filter((e) => people.includes(e.owner) && !e.deleted && !hidden.includes(`${e.accountId}:${e.calendarId}`))))
  const schedules = useData(useShallow((s) => s.schedules.filter((x) => people.includes(x.owner) && !hidden.includes('gooya:schedules'))))
  const users = useData((s) => s.users)
  const lists = useData((s) => s.lists)
  const dark = useIsDark()
  const me = useMe()
  const settings = usePerson(me).settings
  const avoidDuplicates = settings.avoidDuplicates
  const showPast = settings.showPastSchedules
  // Checked every minute only while past schedules are hidden (a schedule leaves as it ends).
  const now = useNow(showPast ? 3_600_000 : 60_000)
  const today = keyInZone(now, viewerTz)
  return useMemo(() => {
    const ordered = [...events].sort((a, b) => (a.source === b.source ? 0 : a.source === 'google' ? -1 : 1))
    const list = [...(avoidDuplicates ? dedupeEvents(ordered) : ordered), ...schedules.map((x) => scheduleAsEvent(x, scheduleHex(x, users, lists, dark)))]
    const out: EventOccurrence[] = []
    for (const e of list) for (const o of expandEvent(e, start, end)) if (showPast || !isPast(o, now, today)) out.push(o)
    out.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start))
    return out
  }, [events, schedules, users, lists, dark, avoidDuplicates, showPast, now, today, start, end])
}

const dayCache = new WeakMap<EventOccurrence, DateKey[]>()

/** The days an event occurrence is on, on this phone's clock (worked out once per occurrence). */
export function daysOf(o: EventOccurrence): DateKey[] {
  let days = dayCache.get(o)
  if (!days) {
    days = eventDays(o, viewerTz)
    dayCache.set(o, days)
  }
  return days
}

export function useEventsByDay(start: number, end: number, people: PersonKey[], zone: string): Map<DateKey, EventOccurrence[]> {
  const occ = useEventOccurrences(start, end, people)
  return useMemo(() => {
    const map = new Map<DateKey, EventOccurrence[]>()
    for (const o of occ) {
      for (const day of zone === viewerTz ? daysOf(o) : eventDays(o, zone)) {
        let list = map.get(day)
        if (!list) map.set(day, (list = []))
        list.push(o)
      }
    }
    return map
  }, [occ, zone])
}
