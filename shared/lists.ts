// What GOOYA's lists hold (the iPhone's Lists and a list's page, the Mac's sidebar) and what each counts. Tasks are
// listed as Reminders lists them: undated ones once, a repeating one at its next day and on each day it was done.
// Schedules each once: a repeating one at its next day (or the one going on), or its last once it has ended. A list
// counts what is still ahead, as Reminders counts the reminders not done: tasks not done and schedules not over (so a
// category counts both). Days are the viewer's, as the calendar shows them: a task due at 9:40 AM in Seoul is on the
// evening before in New York. Dependency-free.

import { categoryOfList, isCategory, type ListIndex } from './categories'
import type { DateKey, EventOccurrence, Routine, Schedule, Task, TaskOccurrence } from './model'
import { expandEvent, expandTask, occurrenceDays } from './recurrence'
import { scheduleAsEvent } from './schedules'
import { addDaysKey, startOfDayMs } from './time'

/** The day a task is on for a viewer in `tz`, as the calendar has it ('' without a date). */
export function taskDay(o: TaskOccurrence, tz: string): DateKey {
  return o.dueDate ? occurrenceDays(o, tz)[0] : ''
}

/** These people's tasks as lists show them; `tz` is the viewer's (the window of repeating ones: a year back, 400 days on). */
export function listTasks(tasks: readonly Task[], people: readonly string[], today: DateKey, tz: string): TaskOccurrence[] {
  const from = startOfDayMs(addDaysKey(today, -365), tz)
  const to = startOfDayMs(addDaysKey(today, 400), tz)
  const out: TaskOccurrence[] = []
  for (const t of tasks) {
    if (!people.includes(t.owner)) continue
    if (!t.dueDate) {
      out.push({ kind: 'task', task: t, key: `${t.id}:`, dateKey: '', isRecurring: false, dueDate: '', dueTime: null, allDay: true, start: 0, end: 0, title: t.title, notes: t.notes, completed: !!t.completed })
      continue
    }
    if (!t.rrule) {
      out.push(...expandTask(t, 0, Number.MAX_SAFE_INTEGER))
      continue
    }
    const all = expandTask(t, from, to)
    const next = all.find((o) => !o.completed && taskDay(o, tz) >= today) ?? all.find((o) => !o.completed)
    for (const o of all) if (o.completed || o === next) out.push(o)
  }
  return out
}

/** A schedule as a list shows it. */
export interface ListedSchedule {
  schedule: Schedule
  occ: EventOccurrence
  /** It has ended: a list shows it under Past Schedules and doesn't count it. */
  over: boolean
}

/** These people's schedules as lists show them, drawn in `colorOf`'s colour (counting needs none). */
export function listSchedules(schedules: readonly Schedule[], people: readonly string[], today: DateKey, now: number, tz: string, colorOf: (s: Schedule) => string = () => ''): ListedSchedule[] {
  const from = startOfDayMs(addDaysKey(today, -400), tz)
  const to = startOfDayMs(addDaysKey(today, 800), tz)
  const out: ListedSchedule[] = []
  for (const s of schedules) {
    if (!people.includes(s.owner)) continue
    const all = expandEvent(scheduleAsEvent(s, colorOf(s)), from, to)
    const shown = s.rrule ? [all.find((o) => Math.max(o.end, o.start) >= now) ?? all[all.length - 1]].filter((o) => !!o) : all
    for (const occ of shown) out.push({ schedule: s, occ, over: Math.max(occ.end, occ.start) < now })
  }
  return out
}

export interface ListCounts {
  /** Each category's tasks not done (through its Reminders lists too) and schedules not over; a Reminders list in no category, its tasks not done. */
  byList: Map<string, number>
  /** The smart lists': tasks not done due by today, with a date, all of them; and the tasks done. */
  today: number
  scheduled: number
  all: number
  completed: number
  /** Library's: tasks not done, schedules not over, and routines. */
  tasks: number
  schedules: number
  routines: number
}

/** What each list counts, from `listTasks` and `listSchedules` (these people's) and the routines (anyone's); `tz` is the viewer's. */
export function countLists(tasks: readonly TaskOccurrence[], schedules: readonly ListedSchedule[], routines: readonly Routine[], people: readonly string[], today: DateKey, tz: string, byId: ListIndex): ListCounts {
  const byList = new Map<string, number>()
  const add = (id: string) => byList.set(id, (byList.get(id) ?? 0) + 1)
  const open = tasks.filter((o) => !o.completed)
  for (const o of open) add(categoryOfList(o.task.listId, byId)?.id ?? o.task.listId)
  const ahead = schedules.filter((x) => !x.over)
  for (const { schedule } of ahead) {
    const category = schedule.categoryId ? byId.get(schedule.categoryId) : undefined
    if (category && isCategory(category)) add(category.id)
  }
  return {
    byList,
    today: open.filter((o) => !!o.dueDate && taskDay(o, tz) <= today).length,
    scheduled: open.filter((o) => !!o.dueDate).length,
    all: open.length,
    completed: tasks.length - open.length,
    tasks: open.length,
    schedules: ahead.length,
    routines: routines.filter((r) => people.includes(r.owner)).length,
  }
}
