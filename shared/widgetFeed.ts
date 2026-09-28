import type { Schedule, ScheduleOccurrence } from './model'
import { expandSchedule } from './recurrence'
import { DAY_MS } from './time'

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
