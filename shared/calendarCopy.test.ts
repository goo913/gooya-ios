import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Schedule, Task } from './model'
import { deletedInCalendar, plainNotes, scheduleChangeFromCopy, scheduleOccurrenceChange, taskChangeFromCopy, taskOccurrenceChange, type CalendarCopy } from './calendarCopy'

const task = (extra: Partial<Task> = {}): Task =>
  ({
    id: 't1', owner: 'gooya', createdBy: 'gooya', listId: 'tasks', title: 'Dentist', notes: '', dueDate: '2026-10-02', dueTime: '15:00', timezone: 'America/New_York',
    rrule: null, exdates: [], overrides: {}, completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false, priority: 0, source: 'gooya',
    externalRefs: [], createdAt: 0, updatedAt: 1000, ...extra,
  }) as Task

const schedule = (extra: Partial<Schedule> = {}): Schedule =>
  ({
    id: 's1', owner: 'gooya', title: 'Sleep', icon: '💤', kind: 'sleep', color: null, startTime: '23:00', endTime: '07:00', timezone: 'America/New_York',
    rrule: 'FREQ=DAILY', startDate: '2026-09-01', endDate: null, exdates: [], overrides: {}, createdAt: 0, updatedAt: 1000, ...extra,
  }) as Schedule

const copy = (extra: Partial<CalendarCopy> = {}): CalendarCopy => ({ title: 'Dentist', notes: '', allDay: false, startDate: '2026-10-02', startTime: '15:00', endTime: '15:15', updated: 2000, ...extra })

test('a copy that says what GOOYA has changes nothing', () => {
  assert.equal(taskChangeFromCopy(task(), copy()), null)
})

test('moving a task in the calendar moves it in GOOYA', () => {
  assert.deepEqual(taskChangeFromCopy(task(), copy({ startDate: '2026-10-03', startTime: '10:00' })), { dueDate: '2026-10-03', dueTime: '10:00' })
  assert.deepEqual(taskChangeFromCopy(task(), copy({ allDay: true, startTime: null, endTime: null })), { dueDate: '2026-10-02', dueTime: null })
})

test('renaming and notes come back; notes written as HTML become text', () => {
  assert.deepEqual(taskChangeFromCopy(task(), copy({ title: 'Dentist (Dr. Kim)', notes: 'Bring card<br>Floor 2' })), { title: 'Dentist (Dr. Kim)', notes: 'Bring card\nFloor 2' })
  assert.equal(plainNotes('See <a href="https://x.example">https://x.example</a> &amp; call'), 'See https://x.example & call')
})

test('GOOYA changed the task after the copy was changed: GOOYA wins', () => {
  assert.equal(taskChangeFromCopy(task({ updatedAt: 3000 }), copy({ startTime: '10:00' })), null)
})

test('a schedule takes the new times and title, without its icon', () => {
  assert.deepEqual(scheduleChangeFromCopy(schedule(), copy({ title: '💤 Sleep', startTime: '23:30', endTime: '07:00' })), { startTime: '23:30' , endTime: '07:00' })
  assert.deepEqual(scheduleChangeFromCopy(schedule(), copy({ title: '💤 Nap', startTime: '23:00', endTime: '07:00' })), { title: 'Nap' })
})

test('one occurrence deleted or moved in the calendar', () => {
  const t = task({ rrule: 'FREQ=WEEKLY' })
  assert.deepEqual(taskOccurrenceChange(t, { dateKey: '2026-10-09', cancelled: true }), { exdates: ['2026-10-09'] })
  assert.equal(taskOccurrenceChange(task({ rrule: 'FREQ=WEEKLY', exdates: ['2026-10-09'] }), { dateKey: '2026-10-09', cancelled: true }), null)
  assert.deepEqual(taskOccurrenceChange(t, { dateKey: '2026-10-09', cancelled: false, copy: copy({ startDate: '2026-10-10', startTime: '15:00' }) }), { overrides: { '2026-10-09': { dueDate: '2026-10-10', dueTime: '15:00' } } })
  assert.equal(taskOccurrenceChange(t, { dateKey: '2026-10-09', cancelled: false, copy: copy({ startDate: '2026-10-09' }) }), null)
  const s = schedule()
  assert.deepEqual(scheduleOccurrenceChange(s, { dateKey: '2026-10-05', cancelled: false, copy: copy({ title: '💤 Sleep', startDate: '2026-10-05', startTime: '00:30', endTime: '08:00' }) }), { overrides: { '2026-10-05': { startTime: '00:30', endTime: '08:00' } } })
})

test('a copy that disappears was deleted there only if GOOYA still puts it there', () => {
  assert.equal(deletedInCalendar(task(), 'task'), true)
  assert.equal(deletedInCalendar(task({ completed: true }), 'task'), false)
  assert.equal(deletedInCalendar(task({ dueDate: null }), 'task'), false)
  assert.equal(deletedInCalendar(null, 'task'), false)
  assert.equal(deletedInCalendar(schedule(), 'schedule'), true)
})
