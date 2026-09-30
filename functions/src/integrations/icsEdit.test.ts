import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CalendarEvent } from '../../../shared/model'
import { zonedMs } from '../../../shared/time'
import { applyEventToIcs, copyFromIcs, parseIcsEvent } from './icsEdit'

// An event as Apple Calendar writes it to iCloud: its own VTIMEZONE, an alert, an invitee, a weekly repeat.
const APPLE = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 27.0//EN', 'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'DTSTART:20070311T020000', 'TZNAME:EDT', 'TZOFFSETTO:-0400', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'DTSTART:20071104T020000', 'TZNAME:EST', 'TZOFFSETTO:-0500', 'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:ABC-123', 'DTSTAMP:20260901T120000Z', 'CREATED:20260901T120000Z', 'LAST-MODIFIED:20260901T120000Z', 'SEQUENCE:0',
  'DTSTART;TZID=America/New_York:20260907T100000', 'DTEND;TZID=America/New_York:20260907T110000', 'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'SUMMARY:Team sync', 'LOCATION:Room 4', 'ATTENDEE;CN=Eunbi;PARTSTAT=ACCEPTED:mailto:eunbi@example.com',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM',
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n')

const NY = 'America/New_York'

function eventFrom(data: string): CalendarEvent {
  const p = parseIcsEvent(data, NY)!
  return { id: 'a_x', owner: 'gooya', source: 'apple', accountId: 'a', calendarId: 'c', calendarName: 'Work', externalId: 'https://x/1.ics', iCalUID: p.uid, title: p.title, notes: p.notes, location: p.location, allDay: p.allDay, start: p.start, end: p.end, startDate: p.startDate, endDate: p.endDate, timezone: p.timezone, rrule: p.rrule, exdates: p.exdates, overrides: p.overrides, color: '#f00', editable: true, etag: '', updatedAt: 0 }
}

test('reads an Apple event', () => {
  const p = parseIcsEvent(APPLE, 'UTC')!
  assert.equal(p.timezone, NY)
  assert.equal(p.start, zonedMs('2026-09-07', '10:00', NY))
  assert.equal(p.end, zonedMs('2026-09-07', '11:00', NY))
  assert.equal(p.rrule, 'FREQ=WEEKLY;BYDAY=MO')
  assert.equal(p.location, 'Room 4')
})

test('a series edit keeps the alert, invitee and zone', () => {
  const ev = eventFrom(APPLE)
  const out = applyEventToIcs(APPLE, { ...ev, title: 'Team sync (moved)', start: zonedMs('2026-09-07', '14:00', NY), end: zonedMs('2026-09-07', '15:30', NY), location: '' }, Date.UTC(2026, 8, 29))
  assert.match(out, /SUMMARY:Team sync \(moved\)/)
  assert.match(out, /DTSTART;TZID=America\/New_York:20260907T140000/)
  assert.match(out, /DTEND;TZID=America\/New_York:20260907T153000/)
  assert.doesNotMatch(out, /LOCATION/)
  assert.match(out, /BEGIN:VALARM[\s\S]*TRIGGER:-PT15M[\s\S]*END:VALARM/)
  assert.match(out, /ATTENDEE;CN=Eunbi/)
  assert.match(out, /BEGIN:VTIMEZONE/)
  assert.match(out, /SEQUENCE:1/)
  const back = parseIcsEvent(out, 'UTC')!
  assert.equal(back.start, zonedMs('2026-09-07', '14:00', NY))
})

test('one occurrence moved and another deleted, as Apple Calendar writes them', () => {
  const ev = eventFrom(APPLE)
  const out = applyEventToIcs(APPLE, {
    ...ev,
    exdates: ['2026-09-21'],
    overrides: { '2026-09-14': { title: 'Team sync (late)', start: zonedMs('2026-09-14', '16:00', NY), end: zonedMs('2026-09-14', '17:00', NY) } },
  })
  assert.match(out, /EXDATE;TZID=America\/New_York:20260921T100000/)
  assert.match(out, /RECURRENCE-ID;TZID=America\/New_York:20260914T100000/)
  assert.match(out, /DTSTART;TZID=America\/New_York:20260914T160000/)
  const back = parseIcsEvent(out, 'UTC')!
  assert.deepEqual(back.exdates, ['2026-09-21'])
  assert.equal(back.overrides['2026-09-14'].title, 'Team sync (late)')
  assert.equal(back.overrides['2026-09-14'].start, zonedMs('2026-09-14', '16:00', NY))
  // Written again with nothing new: the same single exception and exdate.
  const again = applyEventToIcs(out, eventFrom(out))
  assert.equal(again.match(/RECURRENCE-ID/g)?.length, 1)
  assert.equal(again.match(/EXDATE/g)?.length, 1)
})

test('an all-day event made in GOOYA', () => {
  const out = applyEventToIcs(null, { ...eventFrom(APPLE), iCalUID: '', rrule: null, exdates: [], overrides: {}, allDay: true, startDate: '2026-10-01', endDate: '2026-10-02', start: zonedMs('2026-10-01', '00:00', NY), end: zonedMs('2026-10-03', '00:00', NY), title: 'Trip', location: '' })
  assert.match(out, /DTSTART;VALUE=DATE:20261001/)
  assert.match(out, /DTEND;VALUE=DATE:20261003/)
  assert.match(out, /UID:[0-9A-F-]{36}/)
  const back = parseIcsEvent(out, NY)!
  assert.equal(back.allDay, true)
  assert.equal(back.endDate, '2026-10-02')
})

test('GOOYA\'s own copy read back, with a floating TZID and no VTIMEZONE', () => {
  const ours = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:t1@gooya', 'DTSTAMP:20260929T000000Z', 'LAST-MODIFIED:20260929T150000Z', 'SUMMARY:Dentist', 'DTSTART;TZID=America/New_York:20261002T150000', 'DTEND;TZID=America/New_York:20261002T151500', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const c = copyFromIcs(ours, NY)!
  assert.deepEqual(c.copy, { title: 'Dentist', notes: '', allDay: false, startDate: '2026-10-02', startTime: '15:00', endTime: '15:15', updated: Date.UTC(2026, 8, 29, 15) })
})
