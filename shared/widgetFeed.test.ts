import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Schedule } from './model'
import { todayScheduleOccurrences } from './widgetFeed'
import { startOfDayMs } from './time'

const TZ = 'America/New_York'
const TODAY = '2026-09-28'
const H = 3_600_000

function schedule(id: string, startTime: string, endTime: string, rrule = 'FREQ=DAILY'): Schedule {
  return {
    id,
    owner: 'gooya',
    title: id,
    icon: '💤',
    kind: 'sleep',
    color: null,
    startTime,
    endTime,
    timezone: TZ,
    rrule,
    startDate: '2026-01-01',
    endDate: null,
    exdates: [],
    overrides: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

test('a cross-midnight Sleep block appears once, not twice (round 2 §10)', () => {
  const dayStart = startOfDayMs(TODAY, TZ)
  const rows = todayScheduleOccurrences([schedule('Sleep', '23:30', '07:00')], dayStart, dayStart + 12 * H)
  assert.equal(rows.length, 1)
  // At noon, last night's block has ended; tonight's is the one to show.
  assert.equal(rows[0].start, dayStart + 23.5 * H)
})

test('an in-progress cross-midnight block wins over tonight\'s repeat', () => {
  const dayStart = startOfDayMs(TODAY, TZ)
  const rows = todayScheduleOccurrences([schedule('Sleep', '23:30', '07:00')], dayStart, dayStart + 2 * H)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].end, dayStart + 7 * H)
})

test('blocks that already ended today are dropped', () => {
  const dayStart = startOfDayMs(TODAY, TZ)
  const rows = todayScheduleOccurrences([schedule('Work', '09:00', '17:00')], dayStart, dayStart + 18 * H)
  assert.equal(rows.length, 0)
})

test('rows are sorted by start across schedules', () => {
  const dayStart = startOfDayMs(TODAY, TZ)
  const rows = todayScheduleOccurrences([schedule('Sleep', '23:30', '07:00'), schedule('Gym', '18:00', '19:00')], dayStart, dayStart + 8 * H)
  assert.deepEqual(
    rows.map((r) => r.schedule.id),
    ['Gym', 'Sleep'],
  )
})
