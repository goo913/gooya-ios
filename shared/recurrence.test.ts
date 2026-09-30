import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandRoutine, expandTask, splitByDay, occurrenceDays, describeRule, withUntil } from './recurrence.ts'
import { keyInZone, zonedMs, fieldsInZone, offsetMinutes } from './time.ts'
import type { Routine, Task } from './model.ts'

const NY = 'America/New_York'
const SEOUL = 'Asia/Seoul'

const baseRoutine: Routine = {
  id: 'work', owner: 'eunbi', title: 'Work', icon: '💼', kind: 'work', color: null,
  startTime: '09:00', endTime: '17:00', timezone: SEOUL,
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', startDate: '2026-01-05', endDate: null,
  exdates: [], overrides: {}, createdAt: 0, updatedAt: 0,
}

test('Seoul 9-5 lands at 8 PM previous evening in Georgia (13h gap in US DST)', () => {
  const start = zonedMs('2026-09-29', '09:00', SEOUL)
  const f = fieldsInZone(start, NY)
  assert.equal(f.d, 28)
  assert.equal(f.h, 20)
  assert.equal(offsetMinutes(start, SEOUL) - offsetMinutes(start, NY), 13 * 60)
})

test('gap becomes 14h after US DST ends on Nov 1 2026', () => {
  const start = zonedMs('2026-11-03', '09:00', SEOUL)
  const f = fieldsInZone(start, NY)
  assert.equal(f.d, 2)
  assert.equal(f.h, 19)
  assert.equal(offsetMinutes(start, SEOUL) - offsetMinutes(start, NY), 14 * 60)
})

test('weekday routine expands only Mon-Fri and respects exdates/overrides', () => {
  const s: Routine = { ...baseRoutine, exdates: ['2026-09-30'], overrides: { '2026-10-01': { startTime: '10:00', endTime: '15:00' } } }
  const occ = expandRoutine(s, zonedMs('2026-09-27', '00:00', SEOUL), zonedMs('2026-10-04', '00:00', SEOUL))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'])
  const thu = occ.find((o) => o.dateKey === '2026-10-01')!
  assert.equal(fieldsInZone(thu.start, SEOUL).h, 10)
  assert.equal(fieldsInZone(thu.end, SEOUL).h, 15)
})

test('sleep routine crossing midnight spans into the next day', () => {
  const sleep: Routine = { ...baseRoutine, id: 'sleep', title: 'Sleep', icon: '💤', kind: 'sleep', startTime: '23:00', endTime: '07:00', rrule: 'FREQ=DAILY', startDate: '2026-01-01' }
  const occ = expandRoutine(sleep, zonedMs('2026-09-28', '00:00', SEOUL), zonedMs('2026-09-29', '00:00', SEOUL))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-09-27', '2026-09-28'])
  const segs = splitByDay(occ[1], SEOUL)
  assert.equal(segs.length, 2)
  assert.equal(segs[0].startMin, 23 * 60)
  assert.equal(segs[1].endMin, 7 * 60)
})

test('routine endDate (UNTIL) stops the series', () => {
  const s: Routine = { ...baseRoutine, endDate: '2026-09-29' }
  const occ = expandRoutine(s, zonedMs('2026-09-27', '00:00', SEOUL), zonedMs('2026-10-04', '00:00', SEOUL))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-09-28', '2026-09-29'])
})

const baseTask: Task = {
  id: 't1', owner: 'gooya', createdBy: 'gooya', listId: 'tasks', title: 'Gym', notes: '',
  dueDate: '2026-03-02', dueTime: '09:00', timezone: NY, rrule: 'FREQ=DAILY',
  exdates: [], overrides: {}, completed: false, completedDates: ['2026-03-10'], earlyReminders: [15],
  tags: [], flagged: false, priority: 0, source: 'gooya', externalRefs: [], createdAt: 0, updatedAt: 0,
}

test('daily 9 AM Georgia task stays 9 AM across the DST change (Mar 8 2026)', () => {
  const occ = expandTask(baseTask, zonedMs('2026-03-07', '00:00', NY), zonedMs('2026-03-11', '00:00', NY))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  for (const o of occ) assert.equal(fieldsInZone(o.start, NY).h, 9)
  assert.equal(occ[3].completed, true)
  assert.equal(occ[0].completed, false)
  assert.equal(occ[0].allDay, false)
})

test('override moves a single occurrence and can drop its time', () => {
  const t: Task = { ...baseTask, overrides: { '2026-03-09': { dueDate: '2026-03-09', dueTime: '14:00', title: 'Gym (late)' }, '2026-03-10': { dueTime: null } } }
  const occ = expandTask(t, zonedMs('2026-03-09', '00:00', NY), zonedMs('2026-03-11', '00:00', NY))
  assert.equal(occ.length, 2)
  assert.equal(occ[0].title, 'Gym (late)')
  assert.equal(fieldsInZone(occ[0].start, NY).h, 14)
  assert.equal(occ[1].allDay, true)
  assert.equal(fieldsInZone(occ[1].start, NY).h, 9) // date-only tasks alert at 9 AM
})

test('date-only weekly task expands on its dates', () => {
  const t: Task = { ...baseTask, dueDate: '2026-09-04', dueTime: null, rrule: 'FREQ=WEEKLY' }
  const occ = expandTask(t, zonedMs('2026-09-10', '00:00', NY), zonedMs('2026-09-20', '00:00', NY))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-09-11', '2026-09-18'])
  assert.deepEqual(occurrenceDays(occ[0], SEOUL), ['2026-09-11'])
})

test('timed task viewed from Seoul shows on the local date of its instant', () => {
  const t: Task = { ...baseTask, rrule: null, dueDate: '2026-09-28', dueTime: '20:00' }
  const occ = expandTask(t, zonedMs('2026-09-28', '00:00', NY), zonedMs('2026-09-30', '00:00', NY))
  assert.equal(occ.length, 1)
  assert.deepEqual(occurrenceDays(occ[0], SEOUL), ['2026-09-29'])
  assert.equal(keyInZone(occ[0].start, SEOUL), '2026-09-29')
})

test('undated tasks never expand; withUntil ends a series', () => {
  assert.equal(expandTask({ ...baseTask, dueDate: null }, 0, Date.now() * 2).length, 0)
  const t: Task = { ...baseTask, rrule: withUntil('FREQ=DAILY', '2026-03-08') }
  const occ = expandTask(t, zonedMs('2026-03-07', '00:00', NY), zonedMs('2026-03-11', '00:00', NY))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-03-07', '2026-03-08'])
})

test('describeRule uses Apple wording', () => {
  assert.equal(describeRule(null), 'Never')
  assert.equal(describeRule('FREQ=DAILY'), 'Every Day')
  assert.equal(describeRule('FREQ=WEEKLY;INTERVAL=2'), 'Every 2 Weeks')
  assert.equal(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'Every Weekday')
})

test('imported events: recurring timed events expand in their zone and dedupe across sources', async () => {
  const { expandEvent, dedupeEvents } = await import('./recurrence.ts')
  const base = {
    id: 'g1', owner: 'gooya' as const, source: 'google' as const, accountId: 'a', calendarId: 'c', calendarName: 'Work', externalId: 'x', iCalUID: 'uid-1',
    title: 'Standup', notes: '', location: '', allDay: false, start: zonedMs('2026-09-28', '10:00', NY), end: zonedMs('2026-09-28', '10:30', NY),
    startDate: '2026-09-28', endDate: '2026-09-28', timezone: NY, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', exdates: ['2026-09-30'], overrides: {},
    color: '#3f51b5', editable: false, etag: '1', updatedAt: 0,
  }
  const occ = expandEvent(base, zonedMs('2026-09-28', '00:00', NY), zonedMs('2026-10-03', '00:00', NY))
  assert.deepEqual(occ.map((o) => o.dateKey), ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'])
  assert.equal(fieldsInZone(occ[0].start, NY).h, 10)
  const apple = { ...base, id: 'a1', source: 'apple' as const, iCalUID: 'uid-1' }
  assert.equal(dedupeEvents([base, apple]).length, 1)
  const apple2 = { ...apple, iCalUID: 'other', title: 'Standup' }
  assert.equal(dedupeEvents([base, apple2]).length, 1) // same title + start + end
  const apple3 = { ...apple2, start: base.start + 3600_000 }
  assert.equal(dedupeEvents([base, apple3]).length, 2)
})

test('a schedule without an end time is one moment on its day (the day view draws it)', () => {
  const start = Date.UTC(2026, 8, 29, 13) // 9:00 AM in New York
  const segs = splitByDay({ start, end: start }, 'America/New_York')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].dateKey, '2026-09-29')
  assert.equal(segs[0].startMin, 9 * 60)
  assert.equal(segs[0].endMin, 9 * 60)
})
