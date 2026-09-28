import { useMemo } from 'react'
import { useData } from '@/store/data'
import type { PersonKey } from '@shared/people'
import type { DateKey, EventOccurrence, ScheduleOccurrence, TaskOccurrence } from '@shared/model'
import { dedupeEvents, eventDays, expandEvent, expandSchedule, expandTask, occurrenceDays } from '@shared/recurrence'
import { useShallow } from 'zustand/react/shallow'
import { useMe, usePerson } from './people'

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

export function useScheduleOccurrences(start: number, end: number, people: PersonKey[]): ScheduleOccurrence[] {
  const schedules = useData(useShallow((s) => s.schedules.filter((t) => people.includes(t.owner))))
  return useMemo(() => {
    const out: ScheduleOccurrence[] = []
    for (const s of schedules) out.push(...expandSchedule(s, start, end))
    out.sort((a, b) => a.start - b.start)
    return out
  }, [schedules, start, end])
}

/** Imported calendar events for people within [start, end), deduped when the setting is on. */
export function useEventOccurrences(start: number, end: number, people: PersonKey[]): EventOccurrence[] {
  const events = useData(useShallow((s) => s.events.filter((e) => people.includes(e.owner) && !e.deleted)))
  const me = useMe()
  const avoidDuplicates = usePerson(me).settings.avoidDuplicates
  return useMemo(() => {
    const ordered = [...events].sort((a, b) => (a.source === b.source ? 0 : a.source === 'google' ? -1 : 1))
    const list = avoidDuplicates ? dedupeEvents(ordered) : ordered
    const out: EventOccurrence[] = []
    for (const e of list) out.push(...expandEvent(e, start, end))
    out.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start))
    return out
  }, [events, avoidDuplicates, start, end])
}

export function useEventsByDay(start: number, end: number, people: PersonKey[], viewerTz: string): Map<DateKey, EventOccurrence[]> {
  const occ = useEventOccurrences(start, end, people)
  return useMemo(() => {
    const map = new Map<DateKey, EventOccurrence[]>()
    for (const o of occ) {
      for (const day of eventDays(o, viewerTz)) {
        let list = map.get(day)
        if (!list) map.set(day, (list = []))
        list.push(o)
      }
    }
    return map
  }, [occ, viewerTz])
}
