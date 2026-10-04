import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indexLists } from './categories'
import { countLists, listSchedules, listTasks } from './lists'
import type { Routine, Schedule, Task, TaskList } from './model'
import { startOfDayMs, zonedMs } from './time'

const NY = 'America/New_York'
const TODAY = '2026-10-04' // a Sunday
const NOW = zonedMs(TODAY, '12:00', NY)

const list = (id: string, extra: Partial<TaskList> = {}): TaskList => ({ id, name: id, color: '#8e8e93', icon: 'list', order: 1, createdBy: 'gooya', createdAt: 0, updatedAt: 0, ...extra })
const byId = indexLists([
  list('tasks', { order: 0 }),
  list('personal'),
  list('work'),
  // 은비's Reminders lists: one stands for Personal, one is in no category.
  list('rl_p', { source: 'apple-reminders', owner: 'eunbi', externalId: 'L1', categoryId: 'personal' }),
  list('rl_old', { source: 'apple-reminders', owner: 'eunbi', externalId: 'L2', categoryId: '' }),
])

const task = (id: string, listId: string, dueDate: string | null, extra: Partial<Task> = {}): Task => ({
  id, owner: 'eunbi', createdBy: 'eunbi', listId, title: id, notes: '', dueDate, dueTime: null, timezone: NY, rrule: null, exdates: [], overrides: {},
  completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false, priority: 0, source: 'gooya', externalRefs: [], createdAt: 0, updatedAt: 0, ...extra,
})

const timed = (id: string, categoryId: string | null, day: string, from: string, to: string, extra: Partial<Schedule> = {}): Schedule => ({
  id, owner: 'eunbi', createdBy: 'eunbi', title: id, notes: '', location: '', allDay: false, start: zonedMs(day, from, NY), end: zonedMs(day, to, NY),
  startDate: day, endDate: day, timezone: NY, rrule: null, exdates: [], overrides: {}, categoryId, createdAt: 0, updatedAt: 0, ...extra,
})

const TASKS = [
  task('dueTomorrow', 'personal', '2026-10-05'),
  task('doneYesterday', 'personal', '2026-10-03', { completed: true }),
  task('inRemindersToday', 'rl_p', TODAY),
  task('looseUndated', 'rl_old', null),
  // Daily since Thursday, done Thursday and Friday: listed on those days (done) and once more, today.
  task('daily', 'tasks', '2026-10-01', { rrule: 'FREQ=DAILY', completedDates: ['2026-10-01', '2026-10-02'] }),
  task('gooyas', 'personal', '2026-10-06', { owner: 'gooya', createdBy: 'gooya' }),
]

const SCHEDULES = [
  timed('tuesday', 'personal', '2026-10-06', '12:00', '13:00'),
  timed('friday', 'personal', '2026-10-02', '12:00', '13:00'),
  // Saturdays since August: listed (and counted) once, at the next one.
  timed('saturdays', 'personal', '2026-08-01', '10:00', '11:00', { rrule: 'FREQ=WEEKLY' }),
  // Saturdays in August only: over, listed once at its last.
  timed('august', 'personal', '2026-08-01', '10:00', '11:00', { rrule: 'FREQ=WEEKLY;UNTIL=20260831T235959Z' }),
  timed('uncategorised', null, '2026-10-05', '09:00', '10:00'),
  timed('goingOn', 'work', TODAY, '11:00', '13:00'),
  timed('gooyas', 'personal', '2026-10-07', '09:00', '10:00', { owner: 'gooya', createdBy: 'gooya' }),
  { ...timed('allDayToday', 'personal', TODAY, '00:00', '00:00'), allDay: true, start: startOfDayMs(TODAY, NY), end: startOfDayMs('2026-10-05', NY) },
]

const routine = (id: string, owner: 'gooya' | 'eunbi'): Routine => ({
  id, owner, title: id, icon: '', kind: 'custom', color: null, startTime: '09:00', endTime: '17:00', timezone: NY, rrule: 'FREQ=DAILY', startDate: '2026-01-01', endDate: null,
  exdates: [], overrides: {}, createdAt: 0, updatedAt: 0,
})
const ROUTINES = [routine('work', 'eunbi'), routine('sleep', 'eunbi'), routine('gym', 'gooya')]

test('schedules are listed once each, a repeating one at its next day; ended ones are over', () => {
  const listed = listSchedules(SCHEDULES, ['eunbi'], TODAY, NOW, NY)
  const at = (id: string) => listed.filter((x) => x.schedule.id === id).map((x) => `${x.occ.dateKey}${x.over ? ' over' : ''}`)
  assert.deepEqual(at('saturdays'), ['2026-10-10'])
  assert.deepEqual(at('august'), ['2026-08-29 over'])
  assert.deepEqual(at('friday'), ['2026-10-02 over'])
  assert.deepEqual(at('goingOn'), ['2026-10-04'])
  assert.deepEqual(at('allDayToday'), ['2026-10-04'])
  assert.deepEqual(at('gooyas'), [])
})

test('a category counts its tasks not done and its schedules not over', () => {
  const people = ['eunbi']
  const counts = countLists(listTasks(TASKS, people, TODAY, NY), listSchedules(SCHEDULES, people, TODAY, NOW, NY), ROUTINES, people, TODAY, byId)
  // Personal: the task due tomorrow and the one in 은비's Reminders list for it; Tuesday's, the next Saturday, today's all-day.
  assert.equal(counts.byList.get('personal'), 5)
  assert.equal(counts.byList.get('tasks'), 1)
  assert.equal(counts.byList.get('work'), 1)
  // A Reminders list in no category counts its own tasks; a schedule in no category is in Library's count only.
  assert.equal(counts.byList.get('rl_old'), 1)
  assert.equal(counts.byList.get('rl_p'), undefined)
  assert.deepEqual(
    { today: counts.today, scheduled: counts.scheduled, all: counts.all, completed: counts.completed, tasks: counts.tasks, schedules: counts.schedules, routines: counts.routines },
    { today: 2, scheduled: 3, all: 4, completed: 3, tasks: 4, schedules: 5, routines: 2 },
  )
})

test('with both people ticked, each counts the other’s too', () => {
  const people = ['eunbi', 'gooya']
  const counts = countLists(listTasks(TASKS, people, TODAY, NY), listSchedules(SCHEDULES, people, TODAY, NOW, NY), ROUTINES, people, TODAY, byId)
  assert.equal(counts.byList.get('personal'), 7)
  assert.equal(counts.schedules, 6)
  assert.equal(counts.routines, 3)
})

test('a schedule stops counting once it has ended', () => {
  const people = ['eunbi']
  const later = zonedMs(TODAY, '13:30', NY)
  const counts = countLists([], listSchedules(SCHEDULES, people, TODAY, later, NY), [], people, TODAY, byId)
  assert.equal(counts.byList.get('work'), undefined)
  assert.equal(counts.byList.get('personal'), 3)
})
