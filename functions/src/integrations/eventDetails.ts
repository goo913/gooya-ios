// What else a calendar says about an imported event, for its details as Apple Calendar shows them: who is invited and
// how they answered, the organizer, the video call, busy or free, alerts, attachments. Plain functions over what
// Google's API returns (and the parts the iCloud reader in icsEdit.ts shares), so they can be tested without either.

import type { calendar_v3 } from '@googleapis/calendar'
import type { AttendeeStatus, CalendarEvent, EventAttendee, EventConference } from '../../../shared/model'
import { findConference, hostOf, providerOf } from '../../../shared/conference'

/** At most this many invitees are kept with an event (a company-wide meeting has hundreds); attendeeCount says how many there are. */
export const MAX_ATTENDEES = 50

export type EventDetails = Pick<CalendarEvent, 'attendees' | 'attendeeCount' | 'organizer' | 'myStatus' | 'conference' | 'url' | 'showAs' | 'alerts' | 'attachments' | 'htmlLink'>

type Organizer = NonNullable<CalendarEvent['organizer']>

/** Calendars write the address as the name of someone they have no name for: that is no name. */
const nameFor = (email: string, name: string | null | undefined): string | undefined => {
  const n = name?.trim()
  return n && n.toLowerCase() !== email.toLowerCase() ? n : undefined
}

/** One invitee, with only the fields that say something (what is written to Firestore is what the app reads). */
export function attendee(email: string, name: string | null | undefined, status: AttendeeStatus, flags: { organizer?: boolean; self?: boolean; optional?: boolean } = {}): EventAttendee {
  const shown = nameFor(email, name)
  return {
    email,
    ...(shown ? { name: shown } : {}),
    status,
    ...(flags.organizer ? { organizer: true } : {}),
    ...(flags.self ? { self: true } : {}),
    ...(flags.optional ? { optional: true } : {}),
  }
}

export function organizerOf(email: string, name: string | null | undefined, self: boolean): Organizer {
  const shown = nameFor(email, name)
  return { email, ...(shown ? { name: shown } : {}), ...(self ? { self: true } : {}) }
}

/**
 * The invitation part of an event: the invitees, the organizer first and then everyone else in the calendar's order (at
 * most MAX_ATTENDEES, the owner kept among them); how many are invited in all (attendeeCount, set whenever anyone is);
 * the organizer; and the owner's own answer when they were invited rather than organizing it. An event nobody is
 * invited to has none of these: its organizer is only the calendar it is in, which Apple Calendar does not show either.
 */
export function invitees(people: EventAttendee[], organizer: Organizer | null): Pick<EventDetails, 'attendees' | 'attendeeCount' | 'organizer' | 'myStatus'> {
  const seen = new Set<string>()
  const unique: EventAttendee[] = []
  for (const a of people) {
    const key = a.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(a)
  }
  if (!unique.length) return {}
  const ordered = [...unique.filter((a) => a.organizer), ...unique.filter((a) => !a.organizer)]
  const me = ordered.find((a) => a.self)
  let attendees = ordered.slice(0, MAX_ATTENDEES)
  // Cut short, the owner still has their place (the last one), to see their own answer among the others'.
  if (me && !attendees.includes(me)) attendees = [...attendees.slice(0, MAX_ATTENDEES - 1), me]
  // The organizer's name, when only their entry among the invitees has it.
  const name = organizer && !organizer.name ? ordered.find((a) => a.organizer && a.name && a.email.toLowerCase() === organizer.email.toLowerCase())?.name : undefined
  return {
    attendees,
    attendeeCount: unique.length,
    ...(organizer ? { organizer: name ? { ...organizer, name } : organizer } : {}),
    ...(me && !me.organizer && !organizer?.self ? { myStatus: me.status } : {}),
  }
}

/** Minutes before the start, each once, soonest to the start first; none is undefined (nothing is written). */
export function alertList(minutes: number[]): number[] | undefined {
  const out = [...new Set(minutes.filter((m) => Number.isFinite(m) && m >= 0).map((m) => Math.round(m)))].sort((a, b) => a - b)
  return out.length ? out : undefined
}

/**
 * Google reminders as minutes before the start, for an event's own and for a calendar's defaults. Only the pop-up ones:
 * an email reminder is an email Google sends, not an alert on the phone.
 */
export function googleAlerts(reminders: calendar_v3.Schema$EventReminder[] | null | undefined): number[] {
  return alertList((reminders ?? []).filter((r) => (r.method ?? 'popup') === 'popup' && typeof r.minutes === 'number').map((r) => r.minutes as number)) ?? []
}

const googleStatus = (s: string | null | undefined): AttendeeStatus => (s === 'accepted' || s === 'declined' || s === 'tentative' ? s : 'needsAction')

/** Google's names for the calls it knows, as Apple Calendar names them ("Zoom Meeting" is Zoom). */
const PLAIN_NAMES: [RegExp, string][] = [
  [/google meet|hangout/i, 'Google Meet'],
  [/zoom/i, 'Zoom'],
  [/teams/i, 'Microsoft Teams'],
  [/webex/i, 'Webex'],
  [/facetime/i, 'FaceTime'],
  [/goto/i, 'GoTo Meeting'],
]

function conferenceName(solution: calendar_v3.Schema$ConferenceSolution | undefined, url: string): string {
  if (/^(hangoutsMeet|eventHangout|eventNamedHangout)$/.test(solution?.key?.type ?? '')) return 'Google Meet'
  const given = solution?.name?.trim()
  if (given) return PLAIN_NAMES.find(([pattern]) => pattern.test(given))?.[1] ?? given
  return providerOf(url) ?? hostOf(url)
}

/** A long meeting number grouped the way the call services show it (966 3881 5067, 187 432 954); anything else as given. */
function grouped(code: string): string {
  if (!/^\d{9,12}$/.test(code)) return code
  const sizes = code.length === 9 ? [3, 3, 3] : code.length === 10 ? [3, 3, 4] : code.length === 11 ? [3, 4, 4] : [3, 3, 3, 3]
  let at = 0
  return sizes.map((n) => code.slice(at, (at += n))).join(' ')
}

/** The codes a call gives with its entry points, as Google Calendar writes them under the call. */
const CODES: { field: 'meetingCode' | 'accessCode' | 'passcode' | 'password' | 'pin'; label: string; shown: (code: string) => string }[] = [
  { field: 'meetingCode', label: 'Meeting ID', shown: grouped },
  { field: 'accessCode', label: 'Access code', shown: (c) => c },
  // Typed into the call app as they are: not grouped.
  { field: 'passcode', label: 'Passcode', shown: (c) => c },
  { field: 'password', label: 'Password', shown: (c) => c },
  // Dialled after the number, hash included.
  { field: 'pin', label: 'PIN', shown: (c) => `${grouped(c)}#` },
]

/** "Meeting ID: 966 3881 5067 · Passcode: 482913", or "PIN: 187 432 954#" for a Google Meet dial-in. */
function codesOf(points: calendar_v3.Schema$EntryPoint[]): string | undefined {
  const parts: string[] = []
  for (const { field, label, shown } of CODES) {
    const code = points.map((p) => p[field]?.trim()).find(Boolean)
    if (code) parts.push(`${label}: ${shown(code)}`)
  }
  return parts.length ? parts.join(' · ') : undefined
}

/** A dial-in number to call in one tap: Google Meet gives the PIN apart (tel:+1-470-268-2442,,187432954#). */
function dialIn(p: calendar_v3.Schema$EntryPoint): string {
  const uri = p.uri!.trim()
  const pin = p.pin?.trim()
  return pin && !/[,;]/.test(uri) ? `${uri},,${pin}#` : uri
}

/**
 * The video call of a Google event: its conference data (Google Meet, or an add-on's Zoom, Teams…, with dial-in numbers
 * and codes), else its Meet link, else a call link in its place, source link or notes.
 */
export function googleConference(e: calendar_v3.Schema$Event): EventConference | null {
  const points = e.conferenceData?.entryPoints ?? []
  const video = points.find((p) => p.entryPointType === 'video' && p.uri?.trim())
  if (video) {
    const url = video.uri!.trim()
    const dialIns = points.filter((p) => p.entryPointType === 'phone' && p.uri?.trim())
    const phones = dialIns.slice(0, 3).map(dialIn)
    const details = codesOf([video, ...dialIns.slice(0, 1)])
    return { name: conferenceName(e.conferenceData?.conferenceSolution, url), url, ...(phones.length ? { phones } : {}), ...(details ? { details } : {}) }
  }
  if (e.hangoutLink) return { name: 'Google Meet', url: e.hangoutLink }
  return findConference(e.location, e.source?.url, e.description)
}

/**
 * What else a Google event says, for its details. `defaultAlerts` are its calendar's default alerts (CalendarConfig), for
 * an event that keeps them. Invitees in rooms and other resources are left out: they say where, not who.
 */
export function googleDetails(e: calendar_v3.Schema$Event, defaultAlerts?: number[]): EventDetails {
  const people = (e.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => attendee(a.email!, a.displayName, googleStatus(a.responseStatus), { organizer: !!a.organizer, self: !!a.self, optional: !!a.optional }))
  const organizer = e.organizer?.email ? organizerOf(e.organizer.email, e.organizer.displayName, !!e.organizer.self) : null
  // A calendar's default alerts are for its timed events: which ones its all-day events get, Google's API does not say.
  const alerts = e.reminders?.useDefault ? (e.start?.date ? undefined : alertList(defaultAlerts ?? [])) : alertList(googleAlerts(e.reminders?.overrides))
  const conference = googleConference(e)
  const attachments = (e.attachments ?? []).filter((a) => a.fileUrl).map((a) => ({ title: a.title?.trim() || 'Attachment', url: a.fileUrl! }))
  return {
    ...invitees(people, organizer),
    ...(conference ? { conference } : {}),
    ...(e.source?.url ? { url: e.source.url } : {}),
    showAs: e.transparency === 'transparent' ? 'free' : 'busy',
    ...(alerts ? { alerts } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(e.htmlLink ? { htmlLink: e.htmlLink } : {}),
  }
}
