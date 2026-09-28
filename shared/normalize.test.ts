import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTask } from './normalize.ts'
import { zonedMs } from './time.ts'

test('legacy start/end tasks migrate to dueDate/dueTime on read', () => {
  const legacy = {
    owner: 'gooya', createdBy: 'eunbi', title: 'Dentist', notes: 'bring card', location: 'Midtown Dental', url: 'https://x.example',
    allDay: false, start: zonedMs('2026-10-04', '09:00', 'America/New_York'), end: zonedMs('2026-10-04', '10:00', 'America/New_York'),
    startDate: '2026-10-04', endDate: '2026-10-04', timezone: 'America/New_York', rrule: null, alerts: [0, 30], completed: false,
  }
  const t = normalizeTask('id1', legacy)
  assert.equal(t.dueDate, '2026-10-04')
  assert.equal(t.dueTime, '09:00')
  assert.deepEqual(t.earlyReminders, [30])
  assert.equal(t.listId, 'tasks')
  assert.ok(t.notes.includes('Midtown Dental') && t.notes.includes('https://x.example'))
  assert.equal(t.priority, 0)
  assert.equal(t.flagged, false)
})

test('legacy all-day tasks become date-only', () => {
  const t = normalizeTask('id2', { owner: 'eunbi', title: 'Trip', allDay: true, startDate: '2026-10-10', endDate: '2026-10-12', timezone: 'Asia/Seoul', alerts: [] })
  assert.equal(t.dueDate, '2026-10-10')
  assert.equal(t.dueTime, null)
})

test('round-2 documents pass through unchanged', () => {
  const t = normalizeTask('id3', { owner: 'gooya', title: 'X', dueDate: '2026-11-01', dueTime: null, listId: 'home', tags: ['a'], flagged: true, priority: 3, earlyReminders: [1440] })
  assert.equal(t.listId, 'home')
  assert.deepEqual(t.tags, ['a'])
  assert.equal(t.priority, 3)
  assert.deepEqual(t.earlyReminders, [1440])
})
