import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Task } from './model'
import { baselineOf, planReminderSync, reminderFields, toImport, type DeviceReminder } from './reminders'

function reminder(extra: Partial<DeviceReminder> = {}): DeviceReminder {
  return { id: 'r1', title: 'Pick up package', notes: '', url: '', location: '', dueDate: '2026-09-29', dueTime: '15:00', completed: false, list: 'Reminders', ...extra }
}

/** The task the server made from a reminder, then possibly changed in GOOYA. */
function taskFrom(r: DeviceReminder, extra: Partial<Task> = {}): Task {
  const f = reminderFields(r)
  return {
    id: 'ar_1', owner: 'gooya', createdBy: 'gooya', listId: 'apple-reminders', title: f.title, notes: f.notes, dueDate: f.dueDate, dueTime: f.dueTime,
    timezone: 'America/New_York', rrule: null, exdates: [], overrides: {}, completed: f.completed, completedDates: [], earlyReminders: [], tags: [],
    flagged: false, priority: 0, source: 'apple-reminders', externalRefs: [{ source: 'apple-reminders', accountId: 'gooya', calendarId: 'Reminders', externalId: r.id, updatedAt: 0 }],
    createdAt: 0, updatedAt: 0, ...extra,
  } as Task
}

test('the first sync takes everything from the iPhone', () => {
  const r = reminder()
  const { reminders, changes } = planReminderSync([r], [taskFrom(r, { completed: true, title: 'Other' })], {}, 'gooya')
  assert.deepEqual(changes, [])
  assert.deepEqual(reminders, [r])
})

test('completing in GOOYA completes the reminder', () => {
  const r = reminder()
  const base = baselineOf([r])
  const { reminders, changes } = planReminderSync([r], [taskFrom(r, { completed: true })], base, 'gooya')
  assert.deepEqual(changes, [{ id: 'r1', completed: true }])
  assert.equal(reminders[0].completed, true)
})

test('completing in Reminders wins when GOOYA did not change', () => {
  const r = reminder()
  const base = baselineOf([r])
  const done = { ...r, completed: true }
  const { reminders, changes } = planReminderSync([done], [taskFrom(r)], base, 'gooya')
  assert.deepEqual(changes, [])
  assert.equal(reminders[0].completed, true)
})

test('a change on both sides keeps the iPhone’s', () => {
  const r = reminder()
  const base = baselineOf([r])
  const phone = { ...r, title: 'Pick up the parcel' }
  const { reminders, changes } = planReminderSync([phone], [taskFrom(r, { title: 'Get package' })], base, 'gooya')
  assert.deepEqual(changes, [])
  assert.equal(reminders[0].title, 'Pick up the parcel')
})

test('renaming and re-dating in GOOYA go back to the reminder', () => {
  const r = reminder()
  const base = baselineOf([r])
  const { changes } = planReminderSync([r], [taskFrom(r, { title: 'Pick up package at 4', dueDate: '2026-09-30', dueTime: null })], base, 'gooya')
  assert.deepEqual(changes, [{ id: 'r1', title: 'Pick up package at 4', dueDate: '2026-09-30', dueTime: null }])
})

test('a date cleared in GOOYA is not sent (Reminders keeps it)', () => {
  const r = reminder()
  const base = baselineOf([r])
  const { changes, reminders } = planReminderSync([r], [taskFrom(r, { dueDate: null, dueTime: null })], base, 'gooya')
  assert.deepEqual(changes, [])
  assert.equal(reminders[0].dueDate, '2026-09-29')
})

test('notes edited in GOOYA go back without the reminder’s link', () => {
  const r = reminder({ notes: 'Front desk', url: 'https://ups.example/123' })
  const base = baselineOf([r])
  const { changes } = planReminderSync([r], [taskFrom(r, { notes: 'Back door\nhttps://ups.example/123' })], base, 'gooya')
  assert.deepEqual(changes, [{ id: 'r1', notes: 'Back door' }])
})

test('the other person’s tasks never change my reminders', () => {
  const r = reminder()
  const base = baselineOf([r])
  const { changes } = planReminderSync([r], [taskFrom(r, { owner: 'eunbi', completed: true })], base, 'gooya')
  assert.deepEqual(changes, [])
})

test('what the server receives', () => {
  assert.deepEqual(toImport(reminder({ notes: 'n', url: 'https://x.example', dueTime: null })), {
    id: 'r1', title: 'Pick up package', notes: 'n', url: 'https://x.example', dueDate: '2026-09-29', dueTime: null, completed: false, list: 'Reminders',
  })
  assert.deepEqual(toImport(reminder({ dueDate: null, dueTime: '15:00' })).dueTime, null)
})
