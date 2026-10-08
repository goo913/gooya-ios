import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CalendarEvent, Schedule, Task, UserDoc } from './model'
import { buildWidgetFeed, hex6 } from './widgetFeed'
import { startOfDayMs, zonedMs } from './time'

const TZ = 'America/New_York'
const TODAY = '2026-09-28'
const H = 3_600_000

function user(key: 'gooya' | 'eunbi', extra: Partial<UserDoc> = {}): UserDoc {
  return { key, email: '', name: key === 'gooya' ? '구야' : '은비', timezone: key === 'gooya' ? TZ : 'Asia/Seoul', color: '#0091ff', fcmTokens: [], settings: {}, ...extra }
}

function task(id: string, owner: 'gooya' | 'eunbi', dueDate: string, dueTime: string | null, extra: Partial<Task> = {}): Task {
  return {
    id, owner, createdBy: owner, listId: 'tasks', title: id, notes: '', dueDate, dueTime, timezone: TZ, rrule: null, exdates: [], overrides: {},
    completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false, priority: 0, source: 'gooya', externalRefs: [], createdAt: 0, updatedAt: 0, ...extra,
  }
}

function schedule(id: string, owner: 'gooya' | 'eunbi', date: string, from: string, to: string): Schedule {
  return {
    id, owner, createdBy: owner, title: id, notes: '', location: '', allDay: false, start: zonedMs(date, from, TZ), end: zonedMs(date, to, TZ), startDate: date, endDate: date,
    timezone: TZ, rrule: null, exdates: [], overrides: {}, createdAt: 0, updatedAt: 0,
  }
}

function holiday(id: string, first: string, afterLast: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id, owner: 'eunbi', source: 'google', accountId: 'acc', calendarId: 'ko', calendarName: 'Holidays', externalId: id, iCalUID: `${id}@google`, title: id, notes: '', location: '',
    allDay: true, start: startOfDayMs(first, TZ), end: startOfDayMs(afterLast, TZ), startDate: first, endDate: afterLast, timezone: TZ, rrule: null, exdates: [], overrides: {},
    color: '#16A765FF', editable: false, etag: '', updatedAt: 0, ...extra,
  }
}

const base = { me: user('gooya'), users: [user('gooya'), user('eunbi', { color: '#ff9230' })], schedules: [], events: [], lists: [], now: startOfDayMs(TODAY, TZ) + 8 * H }

test('tasks of both people by day, all-day first, with a dot per person and day', () => {
  const feed = buildWidgetFeed({
    ...base,
    tasks: [task('Dentist', 'gooya', '2026-09-30', '14:00'), task('Rent', 'gooya', TODAY, null), task('Standup', 'eunbi', TODAY, '10:00'), task('Old', 'gooya', '2026-09-20', '09:00'), task('Trip', 'eunbi', '2026-10-03', null)],
  })
  assert.equal(feed.today, TODAY)
  assert.equal(feed.me, 'gooya')
  assert.equal(feed.other, 'eunbi')
  assert.deepEqual(
    feed.items.map((i) => i.title),
    ['Old', 'Rent', 'Standup', 'Dentist', 'Trip'],
  )
  assert.equal(feed.items[1].time, 'all-day')
  assert.equal(feed.items[2].time, '10:00 AM')
  assert.deepEqual(feed.dots[TODAY], ['gooya', 'eunbi'])
  assert.deepEqual(feed.dots['2026-09-30'], ['gooya'])
  assert.equal(feed.people[1].colorDark, '#ff9230')
  assert.deepEqual(feed.schedules, [])
})

test('the days covered: the month grid from the Sunday before the 1st, this week and the next, and a month ahead', () => {
  const feed = buildWidgetFeed({ ...base, tasks: [] })
  assert.equal(feed.from, '2026-08-30')
  assert.equal(feed.to, '2026-10-29')
})

test('schedules and connected calendars are on the widget; a multi-day event is on each of its days', () => {
  const feed = buildWidgetFeed({
    ...base,
    tasks: [task('Gym', 'gooya', TODAY, '07:00')],
    schedules: [schedule('Lunch with Minho', 'gooya', '2026-09-29', '12:00', '13:00')],
    events: [holiday('추석연휴', '2026-09-24', '2026-09-27'), holiday('Gone', TODAY, '2026-09-29', { deleted: true })],
  })
  const lunch = feed.items.find((i) => i.title === 'Lunch with Minho')
  assert.equal(lunch?.kind, 'schedule')
  assert.equal(lunch?.time, '12:00 PM')
  assert.equal(lunch?.calendar, 'gooya:schedules')
  assert.equal(lunch?.color, null)
  const chuseok = feed.items.find((i) => i.title === '추석연휴')
  assert.equal(chuseok?.kind, 'event')
  assert.equal(chuseok?.date, '2026-09-24')
  assert.equal(chuseok?.endDate, '2026-09-26')
  assert.equal(chuseok?.color, '#16a765')
  assert.equal(chuseok?.calendar, 'acc:ko')
  assert.deepEqual(feed.dots['2026-09-25'], ['eunbi'])
  assert.equal(feed.items.some((i) => i.title === 'Gone'), false)
})

test('the same event from Google and iCloud is on the widget once, unless the person keeps duplicates', () => {
  const twice = [holiday('Family lunch', TODAY, '2026-09-29', { source: 'apple', accountId: 'icloud', iCalUID: 'x@y' }), holiday('Family lunch', TODAY, '2026-09-29', { iCalUID: 'x@y' })]
  const once = buildWidgetFeed({ ...base, tasks: [], events: twice })
  assert.deepEqual(once.items.map((i) => i.calendar), ['acc:ko'])
  const both = buildWidgetFeed({ ...base, me: user('gooya', { settings: { avoidDuplicates: false } }), tasks: [], events: twice })
  assert.equal(both.items.length, 2)
})

test('completed tasks stay out of the feed when the person hides them', () => {
  const tasks = [task('Done', 'gooya', TODAY, '09:00', { completed: true }), task('Open', 'gooya', TODAY, '11:00')]
  const shown = buildWidgetFeed({ ...base, users: [user('gooya')], tasks })
  assert.deepEqual(shown.items.map((i) => [i.title, i.completed]), [['Done', true], ['Open', false]])
  const hidden = buildWidgetFeed({ ...base, me: user('gooya', { settings: { showCompleted: false } }), users: [user('gooya')], tasks })
  assert.deepEqual(hidden.items.map((i) => i.title), ['Open'])
})

test('a task carries its list colour for the one-person widget', () => {
  const feed = buildWidgetFeed({
    ...base,
    tasks: [task('Milk', 'gooya', TODAY, null, { listId: 'groceries' })],
    lists: [{ id: 'groceries', name: 'Groceries', color: '#34C759', icon: 'cart', order: 0, createdBy: 'gooya', createdAt: 0, updatedAt: 0 }],
  })
  assert.equal(feed.items[0].color, '#34c759')
})

test('colours as calendars send them', () => {
  assert.equal(hex6('#1BADF8FF'), '#1badf8')
  assert.equal(hex6('#abc'), '#aabbcc')
  assert.equal(hex6('blue'), null)
})

const lists = [
  { id: 'tasks', name: 'Tasks', color: '#007aff', icon: 'list', order: 0, createdBy: 'gooya' as const, createdAt: 0, updatedAt: 0 },
  { id: 'bills', name: 'Bills', color: '#34c759', icon: 'list', order: 1, createdBy: 'gooya' as const, createdAt: 0, updatedAt: 0 },
  { id: 'rl_x', name: 'Reminders', color: '#ff9500', icon: 'list', order: 100, createdBy: 'eunbi' as const, createdAt: 0, updatedAt: 0, source: 'apple-reminders' as const, owner: 'eunbi' as const, externalId: 'E1', categoryId: 'bills' },
]

test('tasks and schedules are in their categories’ colours; a schedule’s own colour comes first', () => {
  const feed = buildWidgetFeed({
    ...base,
    lists,
    tasks: [task('Pay rent', 'gooya', TODAY, null, { listId: 'bills' }), task('Water bill', 'eunbi', TODAY, null, { listId: 'rl_x' })],
    schedules: [{ ...schedule('Bank', 'gooya', TODAY, '10:00', '11:00'), categoryId: 'bills' }, { ...schedule('Party', 'gooya', TODAY, '19:00', '20:00'), categoryId: 'bills', color: '#ff2d55' }, schedule('Lunch', 'gooya', TODAY, '12:00', '13:00')],
  })
  const color = (t: string) => feed.items.find((i) => i.title === t)?.color
  // A reminder in 은비's list that stands for Bills is green like Bills; a schedule without a category has none (its owner's).
  assert.deepEqual(['Pay rent', 'Water bill', 'Bank', 'Party', 'Lunch'].map(color), ['#34c759', '#34c759', '#34c759', '#ff2d55', null])
})

test('the other person’s private things are not on the widget; one’s own are', () => {
  const feed = buildWidgetFeed({
    ...base,
    tasks: [task('Mine', 'gooya', TODAY, null, { private: true }), task('Hers', 'eunbi', TODAY, null, { private: true }), task('Shared', 'eunbi', TODAY, null)],
    schedules: [{ ...schedule('Her secret', 'eunbi', TODAY, '10:00', '11:00'), private: true }],
  })
  assert.deepEqual(feed.items.map((i) => i.title).sort(), ['Mine', 'Shared'])
})

test('with Show Past Schedules off, schedules and events that have ended are left out', () => {
  const now = startOfDayMs(TODAY, TZ) + 12 * H
  const input = { ...base, now, tasks: [task('Old task', 'gooya', '2026-09-27', null)], schedules: [schedule('Breakfast', 'gooya', TODAY, '08:00', '09:00'), schedule('Dinner', 'gooya', TODAY, '19:00', '20:00')], events: [holiday('Yesterday', '2026-09-27', TODAY)] }
  const shown = buildWidgetFeed({ ...input, me: user('gooya', { settings: { showPastSchedules: false } }) }).items.map((i) => i.title)
  // Tasks follow Show Completed Tasks, not this.
  assert.deepEqual(shown, ['Old task', 'Dinner'])
  assert.equal(buildWidgetFeed(input).items.length, 4)
})

test('the feed is on the phone’s clock when it is given, as the app shows days (someone away from home)', () => {
  // 은비 (home: Seoul) visiting New York: a task due Thursday 9:40 AM in Seoul is Wednesday 8:40 PM there.
  const tasks = [task('Ruler', 'eunbi', '2026-10-08', '09:40', { timezone: 'Asia/Seoul' })]
  const now = zonedMs('2026-10-07', '12:00', TZ)
  const away = buildWidgetFeed({ ...base, me: user('eunbi'), tasks, now, tz: TZ })
  assert.equal(away.timezone, TZ)
  assert.equal(away.today, '2026-10-07')
  assert.equal(away.items.find((i) => i.title === 'Ruler')?.date, '2026-10-07')
  assert.equal(away.items.find((i) => i.title === 'Ruler')?.time, '8:40 PM')
  // Without it (or with a zone that does not exist), the home zone as before.
  for (const tz of [undefined, 'Not/AZone']) {
    const home = buildWidgetFeed({ ...base, me: user('eunbi'), tasks, now, tz })
    assert.equal(home.timezone, 'Asia/Seoul')
    assert.equal(home.items.find((i) => i.title === 'Ruler')?.date, '2026-10-08')
  }
})
