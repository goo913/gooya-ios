import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDue } from './fmt'
import { zonedMs } from './time'

const NY = 'America/New_York'
const SEOUL = 'Asia/Seoul'

test('a due time reads on the reader’s clock, the day as well as the time', () => {
  // Due Thursday 9:40 AM in Seoul, read on Wednesday evening in New York (Thursday morning in Seoul).
  const due = { allDay: false, dueDate: '2026-10-08', start: zonedMs('2026-10-08', '09:40', SEOUL) }
  const now = zonedMs('2026-10-07', '20:00', NY)
  assert.equal(formatDue(due, NY, now), 'Today · 8:40 PM')
  assert.equal(formatDue(due, SEOUL, now), 'Today · 9:40 AM')
  // A day earlier it is another day on both clocks: Wednesday in New York, Thursday in Seoul.
  const before = now - 24 * 3600_000
  assert.equal(formatDue(due, NY, before), 'Wed, Oct 7 · 8:40 PM')
  assert.equal(formatDue(due, SEOUL, before), 'Thu, Oct 8 · 9:40 AM')
})

test('a date-only task is on its date wherever it is read', () => {
  const due = { allDay: true, dueDate: '2026-10-08', start: zonedMs('2026-10-08', '09:00', SEOUL) }
  assert.equal(formatDue(due, NY, zonedMs('2026-10-08', '08:00', NY)), 'Today')
  assert.equal(formatDue(due, NY, zonedMs('2026-10-07', '22:00', NY)), 'Thu, Oct 8')
})
