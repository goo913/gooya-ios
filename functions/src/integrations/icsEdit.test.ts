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

// ---------------------------------------------------------------- details (invitees, video call, alerts)

// A Google Calendar invitation as iCloud keeps it once Apple Calendar has it: the organizer, invitees with their answers
// (the invited person named by their address, as Google writes them) and a meeting room, the Meet link only in the notes
// Google writes, two alerts.
const GOOGLE_INVITE = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
  'BEGIN:VEVENT', 'DTSTART:20261006T130000Z', 'DTEND:20261006T133000Z', 'DTSTAMP:20260929T180000Z',
  'ORGANIZER;CN=Firman Hadi:mailto:firman@asterakb.com', 'UID:0r5bq3v7kcd2h8m1t9p4s6f2uo@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=goochoi913@gmail.com;X-NUM-GUESTS=0:mailto:goochoi913@gmail.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Firman Hadi;X-NUM-GUESTS=0:mailto:firman@asterakb.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE;CN=Ivy Tran;X-NUM-GUESTS=0:mailto:ivy@theavena.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED;CN=lam@theavena.com;X-NUM-GUESTS=0:mailto:lam@theavena.com',
  'ATTENDEE;CUTYPE=RESOURCE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=HQ-2-Boardroom (10);X-NUM-GUESTS=0:mailto:c_1889abc@resource.calendar.google.com',
  'CREATED:20260929T175900Z',
  'DESCRIPTION:Weekly review of the AVENA AI project.\\n\\n-::~:~::~:~:~:~:~:~:~:~:~:~::~:~::-\\nJoin with Google Meet: https://meet.google.com/jke-jwff-ahm\\nOr dial: (US) +1 470-268-2442 PIN: 187432954#\\nMore phone numbers: https://tel.meet/jke-jwff-ahm?pin=5287641093125\\n\\nLearn more about Meet at: https://support.google.com/a/users/answer/9282720\\n\\nPlease do not edit this section.\\n-::~:~::~:~:~:~:~:~:~:~:~:~::~:~::-',
  'LAST-MODIFIED:20260929T180000Z', 'LOCATION:', 'SEQUENCE:0', 'STATUS:CONFIRMED', 'SUMMARY:AVENA AI Weekly Review', 'TRANSP:OPAQUE',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:This is an event reminder', 'TRIGGER:-P0DT0H30M0S', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:This is an event reminder', 'TRIGGER:-P0DT0H10M0S', 'END:VALARM',
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n')

test('a Google invitation: the invitees with their answers, the organizer first, my answer, the Meet link, the alerts', () => {
  const p = parseIcsEvent(GOOGLE_INVITE, NY, 'GooChoi913@gmail.com')!
  assert.equal(p.title, 'AVENA AI Weekly Review')
  assert.deepEqual(p.details, {
    attendees: [
      { email: 'firman@asterakb.com', name: 'Firman Hadi', status: 'accepted', organizer: true },
      { email: 'goochoi913@gmail.com', status: 'needsAction', self: true },
      { email: 'ivy@theavena.com', name: 'Ivy Tran', status: 'tentative' },
      { email: 'lam@theavena.com', status: 'declined', optional: true },
    ],
    attendeeCount: 4,
    organizer: { email: 'firman@asterakb.com', name: 'Firman Hadi' },
    myStatus: 'needsAction',
    conference: { name: 'Google Meet', url: 'https://meet.google.com/jke-jwff-ahm' },
    showAs: 'busy',
    alerts: [10, 30],
  })
  // Not knowing whose calendar it is, nobody is "me".
  const anyone = parseIcsEvent(GOOGLE_INVITE, NY)!.details
  assert.equal(anyone.myStatus, undefined)
  assert.ok(anyone.attendees!.every((a) => !a.self))
})

// A Zoom meeting made in Apple Calendar by the calendar's owner: the link in the place, the course page as the URL, the
// organizer not among the attendees, an iCloud invitee known by urn:uuid (its address in EMAIL), a room, shown as free.
// One alert the day before; the others are not "minutes before the start" (a set time, after the start, from the end,
// none) or not an alert on the phone (an email, whose recipient is no invitee).
const ZOOM = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 27.0//EN', 'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT', 'UID:8C1F0E7A-4B1D-4E57-9A43-2B7D9C0F5E11', 'DTSTAMP:20260929T150000Z', 'SEQUENCE:0',
  'DTSTART;TZID=America/New_York:20261007T203000', 'DTEND;TZID=America/New_York:20261007T213000',
  'SUMMARY:Superforecasting Reading Group [CS6750]',
  'LOCATION:https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1',
  'DESCRIPTION:Join Zoom Meeting\\nhttps://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1\\n\\nMeeting ID: 966 3881 5067',
  'URL;VALUE=URI:https://gatech.instructure.com/courses/536416',
  'TRANSP:TRANSPARENT',
  'ORGANIZER;CN=Goo Choi:mailto:goochoi913@gmail.com',
  'ATTENDEE;CN=Minho Lee;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:minho@gatech.edu',
  'ATTENDEE;CN="Park, Eunbi";CUTYPE=INDIVIDUAL;EMAIL=evapark7147@gmail.com;PARTSTAT=TENTATIVE:urn:uuid:5A0C3E7B-9D1F-4C2A-8E6B-1F2D3C4B5A69',
  'ATTENDEE;CN=Klaus 1447;CUTYPE=ROOM;PARTSTAT=ACCEPTED:mailto:klaus-1447@gatech.edu',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-P1D', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER;VALUE=DATE-TIME:20261007T230000Z', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:PT5M', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER;RELATED=END:-PT10M', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:EMAIL', 'SUMMARY:Reading group', 'DESCRIPTION:Reading group tonight', 'ATTENDEE:mailto:goochoi913@gmail.com', 'TRIGGER:-PT2H', 'END:VALARM',
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n')

test('a Zoom meeting I organize: the link in the place, the organizer added first, free, the alert the day before', () => {
  const p = parseIcsEvent(ZOOM, 'UTC', 'goochoi913@gmail.com')!
  assert.equal(p.start, zonedMs('2026-10-07', '20:30', NY))
  assert.deepEqual(p.details, {
    attendees: [
      { email: 'goochoi913@gmail.com', name: 'Goo Choi', status: 'accepted', organizer: true, self: true },
      { email: 'minho@gatech.edu', name: 'Minho Lee', status: 'accepted' },
      { email: 'evapark7147@gmail.com', name: 'Park, Eunbi', status: 'tentative' },
    ],
    attendeeCount: 3,
    organizer: { email: 'goochoi913@gmail.com', name: 'Goo Choi', self: true },
    conference: { name: 'Zoom', url: 'https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1' },
    url: 'https://gatech.instructure.com/courses/536416',
    showAs: 'free',
    alerts: [1440],
  })
})

test('an event nobody is invited to has no invitees; an Apple Calendar event keeps its invitee and alert', () => {
  const alone = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:d1', 'DTSTART:20261002T190000Z', 'DTEND:20261002T200000Z', 'SUMMARY:Dentist', 'ORGANIZER:mailto:goochoi913@gmail.com', 'BEGIN:VALARM', 'ACTION:AUDIO', 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  assert.deepEqual(parseIcsEvent(alone, NY, 'goochoi913@gmail.com')!.details, { showAs: 'busy', alerts: [0] })
  assert.deepEqual(parseIcsEvent(APPLE, NY, 'goochoi913@gmail.com')!.details, { attendees: [{ email: 'eunbi@example.com', name: 'Eunbi', status: 'accepted' }], attendeeCount: 1, showAs: 'busy', alerts: [15] })
})

test('the call an invitation names comes before a call link in the place', () => {
  const invite = (extra: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261008T140000Z', 'DTEND:20261008T150000Z', 'SUMMARY:Sync', 'LOCATION:https://zoom.us/j/123456789', ...extra, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  assert.deepEqual(parseIcsEvent(invite(['X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij']), NY)!.details.conference, { name: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' })
  const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjE0MzY3%40thread.v2/0?context=%7b%22Tid%22%3a%2272f988bf%22%7d'
  assert.deepEqual(parseIcsEvent(invite([`X-MICROSOFT-SKYPETEAMSMEETINGURL:${teams}`]), NY)!.details.conference, { name: 'Microsoft Teams', url: teams })
  // Skype for Business writes a conf:sip: address there, which is not a link to open.
  assert.deepEqual(parseIcsEvent(invite(['X-MICROSOFT-ONLINEMEETINGCONFLINK:conf:sip:minho@contoso.com;gruu;opaque=app:conf:focus:id:ABC123']), NY)!.details.conference, { name: 'Zoom', url: 'https://zoom.us/j/123456789' })
})
