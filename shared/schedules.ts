// GOOYA's own schedules (lunch at noon) are drawn, opened, moved and edited like calendar events: as a CalendarEvent
// with source 'gooya', so the month and day views, the details sheet and the editor treat both kinds the same way.

import type { CalendarEvent, Schedule } from './model'

/** The calendar name a schedule shows under ("GOOYA", as the calendar GOOYA keeps in Google and iCloud). */
export const SCHEDULE_CALENDAR = 'GOOYA'

/** A schedule as an event, drawn in `color` (its owner's). */
export function scheduleAsEvent(s: Schedule, color: string): CalendarEvent {
  return {
    id: s.id,
    owner: s.owner,
    source: 'gooya',
    accountId: '',
    calendarId: 'gooya',
    calendarName: SCHEDULE_CALENDAR,
    externalId: '',
    iCalUID: `${s.id}@gooya`,
    title: s.title,
    notes: s.notes,
    location: s.location,
    allDay: s.allDay,
    start: s.start,
    end: s.end,
    startDate: s.startDate,
    endDate: s.endDate,
    timezone: s.timezone,
    rrule: s.rrule,
    exdates: s.exdates,
    overrides: s.overrides,
    color,
    editable: true,
    etag: '',
    updatedAt: s.updatedAt,
  }
}

/** A timed schedule whose end is its start has no end time ("12:00 PM", not "12:00 – 1:00 PM"). */
export function hasEndTime(e: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): boolean {
  return e.allDay || e.end > e.start
}
