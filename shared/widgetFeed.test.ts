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

// ---------------------------------------------------------------- buildWidgetFeed (the Home Screen widget)
import { buildWidgetFeed } from './widgetFeed'
import type { Task, UserDoc } from './model'

function user(key: 'gooya' | 'eunbi', extra: Partial<UserDoc> = {}): UserDoc {
  return { key, email: '', name: key === 'gooya' ? '구야' : '은비', timezone: key === 'gooya' ? TZ : 'Asia/Seoul', color: '#0091ff', fcmTokens: [], settings: {}, ...extra }
}

function task(id: string, owner: 'gooya' | 'eunbi', dueDate: string, dueTime: string | null, extra: Partial<Task> = {}): Task {
  return {
    id, owner, createdBy: owner, listId: 'tasks', title: id, notes: '', dueDate, dueTime, timezone: TZ, rrule: null, exdates: [], overrides: {},
    completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false, priority: 0, source: 'gooya', externalRefs: [], createdAt: 0, updatedAt: 0, ...extra,
  }
}

test('the feed lists both people’s tasks from today on, all-day first, with a dot per person and day', () => {
  const now = startOfDayMs(TODAY, TZ) + 8 * H
  const feed = buildWidgetFeed({
    me: user('gooya'),
    users: [user('gooya'), user('eunbi', { color: '#ff9230' })],
    tasks: [task('Dentist', 'gooya', '2026-09-30', '14:00'), task('Rent', 'gooya', TODAY, null), task('Standup', 'eunbi', TODAY, '10:00'), task('Old', 'gooya', '2026-09-20', '09:00'), task('Trip', 'eunbi', '2026-10-03', null)],
    schedules: [schedule('Work', '09:00', '17:00'), schedule('Sleep', '23:30', '07:00')],
    now,
    days: 7,
  })
  assert.equal(feed.today, TODAY)
  assert.equal(feed.me, 'gooya')
  assert.equal(feed.other, 'eunbi')
  assert.deepEqual(
    feed.items.map((i) => i.title),
    ['Rent', 'Standup', 'Dentist', 'Trip'],
  )
  assert.equal(feed.items[0].time, 'all-day')
  assert.equal(feed.items[1].time, '10:00 AM')
  assert.deepEqual(feed.dots[TODAY], ['gooya', 'eunbi'])
  assert.deepEqual(feed.dots['2026-09-30'], ['gooya'])
  assert.deepEqual(feed.dots['2026-09-20'], ['gooya'])
  assert.deepEqual(
    feed.schedules.map((s) => s.title),
    ['Work', 'Sleep'],
  )
  assert.equal(feed.people[1].colorDark, '#ff9230')
})

test('completed tasks stay out of the feed when the person hides them', () => {
  const now = startOfDayMs(TODAY, TZ) + 8 * H
  const tasks = [task('Done', 'gooya', TODAY, '09:00', { completed: true }), task('Open', 'gooya', TODAY, '11:00')]
  const shown = buildWidgetFeed({ me: user('gooya'), users: [user('gooya')], tasks, schedules: [], now })
  assert.deepEqual(shown.items.map((i) => [i.title, i.completed]), [['Done', true], ['Open', false]])
  const hidden = buildWidgetFeed({ me: user('gooya', { settings: { showCompleted: false } }), users: [user('gooya')], tasks, schedules: [], now })
  assert.deepEqual(hidden.items.map((i) => i.title), ['Open'])
})
