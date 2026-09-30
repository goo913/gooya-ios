import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { calendar_v3 } from '@googleapis/calendar'
import { MAX_ATTENDEES, googleAlerts, googleDetails } from './eventDetails'

// An invitation from Gmail with a Google Meet call, as the Calendar API gives it to the invited person: the organizer is
// not first, a meeting room is invited too, and the event keeps the calendar's default alerts.
const MEET: calendar_v3.Schema$Event = {
  kind: 'calendar#event',
  etag: '"3456789012345678"',
  id: '0r5bq3v7kcd2h8m1t9p4s6f2uo',
  status: 'confirmed',
  htmlLink: 'https://www.google.com/calendar/event?eid=MHI1YnEzdjdrY2QyaDhtMXQ5cDRzNmYydW8gZ29vY2hvaTkxM0Bt',
  summary: 'AVENA AI Weekly Review',
  description: 'Weekly review of the AVENA AI project.',
  creator: { email: 'firman@asterakb.com' },
  organizer: { email: 'firman@asterakb.com' },
  start: { dateTime: '2026-10-06T09:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-10-06T09:30:00-04:00', timeZone: 'America/New_York' },
  iCalUID: '0r5bq3v7kcd2h8m1t9p4s6f2uo@google.com',
  attendees: [
    { email: 'goochoi913@gmail.com', self: true, responseStatus: 'needsAction' },
    { email: 'adriana@asterakb.com', responseStatus: 'accepted' },
    { email: 'firman@asterakb.com', displayName: 'Firman Hadi', organizer: true, responseStatus: 'accepted' },
    { email: 'c_1889abc@resource.calendar.google.com', displayName: 'HQ-2-Boardroom (10)', resource: true, responseStatus: 'accepted' },
    { email: 'ivy@theavena.com', displayName: 'Ivy Tran', responseStatus: 'tentative' },
    { email: 'vtina@asterakb.com', optional: true, responseStatus: 'needsAction' },
  ],
  hangoutLink: 'https://meet.google.com/jke-jwff-ahm',
  conferenceData: {
    entryPoints: [
      { entryPointType: 'video', uri: 'https://meet.google.com/jke-jwff-ahm', label: 'meet.google.com/jke-jwff-ahm' },
      { entryPointType: 'more', uri: 'https://tel.meet/jke-jwff-ahm?pin=5287641093125', pin: '5287641093125' },
      { entryPointType: 'phone', uri: 'tel:+1-470-268-2442', label: '+1 470-268-2442', pin: '187432954', regionCode: 'US' },
    ],
    conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet', iconUri: 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v6/web-512dp/logo_meet_2020q4_color_2x_web_512dp.png' },
    conferenceId: 'jke-jwff-ahm',
  },
  reminders: { useDefault: true },
  eventType: 'default',
  transparency: 'transparent',
}

test('a Google Meet invitation: the invitees with their answers (the organizer first, no room), my answer, the call and its dial-in', () => {
  assert.deepEqual(googleDetails(MEET, [30]), {
    attendees: [
      { email: 'firman@asterakb.com', name: 'Firman Hadi', status: 'accepted', organizer: true },
      { email: 'goochoi913@gmail.com', status: 'needsAction', self: true },
      { email: 'adriana@asterakb.com', status: 'accepted' },
      { email: 'ivy@theavena.com', name: 'Ivy Tran', status: 'tentative' },
      { email: 'vtina@asterakb.com', status: 'needsAction', optional: true },
    ],
    attendeeCount: 5,
    organizer: { email: 'firman@asterakb.com', name: 'Firman Hadi' },
    myStatus: 'needsAction',
    conference: { name: 'Google Meet', url: 'https://meet.google.com/jke-jwff-ahm', phones: ['tel:+1-470-268-2442,,187432954#'], details: 'PIN: 187 432 954#' },
    showAs: 'free',
    alerts: [30],
    htmlLink: 'https://www.google.com/calendar/event?eid=MHI1YnEzdjdrY2QyaDhtMXQ5cDRzNmYydW8gZ29vY2hvaTkxM0Bt',
  })
})

// A Zoom meeting the calendar's owner organizes, made with the Zoom add-on: its conference data has the meeting ID and
// passcode, four dial-in numbers and a "more" page. Its own alerts (an email one too), a Drive file, and the page it was
// made from (source).
const ZOOM: calendar_v3.Schema$Event = {
  id: 'k8s2v1rq3m4n5b6c7d8e9f0g1h',
  status: 'confirmed',
  htmlLink: 'https://www.google.com/calendar/event?eid=azhzMnYxcnEzbTRuNWI2YzdkOGU5ZjBnMWg',
  summary: 'CS 6750 project sync',
  organizer: { email: 'goochoi913@gmail.com', self: true },
  start: { dateTime: '2026-10-08T16:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-10-08T16:45:00-04:00', timeZone: 'America/New_York' },
  attendees: [
    { email: 'goochoi913@gmail.com', organizer: true, self: true, responseStatus: 'accepted' },
    { email: 'minho@gatech.edu', displayName: 'Minho Lee', responseStatus: 'declined' },
  ],
  conferenceData: {
    entryPoints: [
      { entryPointType: 'video', uri: 'https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1', label: 'gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1', meetingCode: '96638815067', passcode: '482913' },
      { entryPointType: 'phone', uri: 'tel:+13126266799,,96638815067#', label: '+1 312-626-6799', regionCode: 'US' },
      { entryPointType: 'phone', uri: 'tel:+16469313860,,96638815067#', label: '+1 646-931-3860', regionCode: 'US' },
      { entryPointType: 'phone', uri: 'tel:+13017158592,,96638815067#', label: '+1 301-715-8592', regionCode: 'US' },
      { entryPointType: 'phone', uri: 'tel:+13052241968,,96638815067#', label: '+1 305-224-1968', regionCode: 'US' },
      { entryPointType: 'more', uri: 'https://gatech.zoom.us/u/abFzVk2Q' },
    ],
    conferenceSolution: { key: { type: 'addOn' }, name: 'Zoom Meeting', iconUri: 'https://lh3.googleusercontent.com/zoom-icon' },
    conferenceId: '96638815067',
    notes: 'Passcode: 482913',
  },
  reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 10 }, { method: 'popup', minutes: 0 }, { method: 'popup', minutes: 10 }] },
  attachments: [{ fileUrl: 'https://docs.google.com/document/d/1xYz/edit', title: 'Reading notes', mimeType: 'application/vnd.google-apps.document', fileId: '1xYz' }, { title: 'No link' }],
  source: { title: 'Canvas', url: 'https://gatech.instructure.com/courses/536416' },
}

test('a Zoom meeting I organize: no answer of mine, the add-on\'s call with its codes, my own alerts, the file and the source link', () => {
  assert.deepEqual(googleDetails(ZOOM, [30]), {
    attendees: [
      { email: 'goochoi913@gmail.com', status: 'accepted', organizer: true, self: true },
      { email: 'minho@gatech.edu', name: 'Minho Lee', status: 'declined' },
    ],
    attendeeCount: 2,
    organizer: { email: 'goochoi913@gmail.com', self: true },
    conference: {
      name: 'Zoom',
      url: 'https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1',
      phones: ['tel:+13126266799,,96638815067#', 'tel:+16469313860,,96638815067#', 'tel:+13017158592,,96638815067#'],
      details: 'Meeting ID: 966 3881 5067 · Passcode: 482913',
    },
    url: 'https://gatech.instructure.com/courses/536416',
    showAs: 'busy',
    alerts: [0, 10],
    attachments: [{ title: 'Reading notes', url: 'https://docs.google.com/document/d/1xYz/edit' }],
    htmlLink: 'https://www.google.com/calendar/event?eid=azhzMnYxcnEzbTRuNWI2YzdkOGU5ZjBnMWg',
  })
})

const timed = (extra: calendar_v3.Schema$Event): calendar_v3.Schema$Event => ({
  id: 'e1',
  summary: 'Dentist',
  organizer: { email: 'goochoi913@gmail.com', self: true },
  creator: { email: 'goochoi913@gmail.com', self: true },
  start: { dateTime: '2026-10-02T15:00:00-04:00' },
  end: { dateTime: '2026-10-02T16:00:00-04:00' },
  reminders: { useDefault: true },
  ...extra,
})

test('an event nobody is invited to says only busy or free, and its default alerts', () => {
  assert.deepEqual(googleDetails(timed({})), { showAs: 'busy' })
  assert.deepEqual(googleDetails(timed({ htmlLink: 'https://www.google.com/calendar/event?eid=ZTE' }), [10, 30]), { showAs: 'busy', alerts: [10, 30], htmlLink: 'https://www.google.com/calendar/event?eid=ZTE' })
  // Only a room: nobody is invited.
  assert.deepEqual(googleDetails(timed({ attendees: [{ email: 'c_1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' }] })), { showAs: 'busy' })
})

test('alerts: the event\'s own pop-ups, else the calendar\'s defaults, which Google gives for timed events only', () => {
  assert.deepEqual(googleAlerts([{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 60 }, { method: 'popup', minutes: 10 }, { method: 'popup', minutes: 30 }, { minutes: 5 }]), [5, 10, 30])
  assert.deepEqual(googleAlerts(undefined), [])
  const allDay = { start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }
  assert.equal(googleDetails(timed({ ...allDay }), [10]).alerts, undefined)
  assert.deepEqual(googleDetails(timed({ ...allDay, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] } }), [10]).alerts, [900])
  assert.equal(googleDetails(timed({ reminders: { useDefault: false } }), [10]).alerts, undefined)
  assert.equal(googleDetails(timed({ reminders: undefined }), [10]).alerts, undefined)
})

test('a call only in the Meet link, the place or the notes', () => {
  assert.deepEqual(googleDetails(timed({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).conference, { name: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' })
  assert.deepEqual(googleDetails(timed({ location: 'https://gatech.zoom.us/j/96638815067?pwd=abc.1' })).conference, { name: 'Zoom', url: 'https://gatech.zoom.us/j/96638815067?pwd=abc.1' })
  const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjE0MzY3%40thread.v2/0?context=%7b%22Tid%22%7d'
  assert.deepEqual(googleDetails(timed({ description: `Join on your computer:<br><a href="${teams}">Click here to join the meeting</a>` })).conference, { name: 'Microsoft Teams', url: teams })
  assert.equal(googleDetails(timed({ description: 'Bring the insurance card' })).conference, undefined)
})

test('a call from an add-on GOOYA does not know keeps the name it gives', () => {
  const addOn = (name: string | undefined, uri: string) => googleDetails(timed({ conferenceData: { conferenceSolution: { key: { type: 'addOn' }, name }, entryPoints: [{ entryPointType: 'video', uri }] } })).conference
  assert.deepEqual(addOn('RingCentral Video', 'https://v.ringcentral.com/join/123456789'), { name: 'RingCentral Video', url: 'https://v.ringcentral.com/join/123456789' })
  assert.deepEqual(addOn('Microsoft Teams Meeting', 'https://teams.microsoft.com/l/meetup-join/19%3a1'), { name: 'Microsoft Teams', url: 'https://teams.microsoft.com/l/meetup-join/19%3a1' })
  assert.deepEqual(addOn(undefined, 'https://whereby.com/goo'), { name: 'whereby.com', url: 'https://whereby.com/goo' })
})

test('a big meeting keeps the organizer first, me among the first MAX_ATTENDEES, and says how many are invited', () => {
  const others = Array.from({ length: 58 }, (_, i) => ({ email: `person${i}@example.com`, responseStatus: 'accepted' }))
  const e = timed({
    organizer: { email: 'ceo@example.com', displayName: 'The CEO' },
    attendees: [...others.slice(0, 55), { email: 'goochoi913@gmail.com', self: true, responseStatus: 'tentative' }, { email: 'ceo@example.com', organizer: true, responseStatus: 'accepted' }, ...others.slice(55)],
  })
  const d = googleDetails(e)
  assert.equal(d.attendeeCount, 60)
  assert.equal(d.attendees!.length, MAX_ATTENDEES)
  assert.deepEqual(d.attendees![0], { email: 'ceo@example.com', status: 'accepted', organizer: true })
  assert.deepEqual(d.attendees![MAX_ATTENDEES - 1], { email: 'goochoi913@gmail.com', status: 'tentative', self: true })
  assert.deepEqual(d.organizer, { email: 'ceo@example.com', name: 'The CEO' })
  assert.equal(d.myStatus, 'tentative')
})
