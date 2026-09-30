// iCloud events as calendar data (iCalendar), read and changed in place: GOOYA rewrites only what it shows (title,
// notes, place, times, deleted or changed occurrences) and leaves alerts, invitees, links and everything else as they
// were. Also reads the copies in GOOYA's own iCloud calendar back into plain values (shared/calendarCopy.ts).

import ICAL from 'ical.js'
import { randomUUID } from 'node:crypto'
import type { CalendarEvent, DateKey, EventOverride } from '../../../shared/model'
import type { CalendarCopy, CopyOccurrence } from '../../../shared/calendarCopy'
import { addDaysKey, fieldsInZone, keyInZone, makeKey, pad2, zonedMs } from '../../../shared/time'

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const keyOf = (t: ICAL.Time): DateKey => makeKey(t.year, t.month, t.day)

/** The instant of a DTSTART/DTEND/RECURRENCE-ID value; floating times are on `fallbackTz`'s clock. */
export function instantOf(prop: ICAL.Property, fallbackTz: string): number {
  const t = prop.getFirstValue() as ICAL.Time
  if (t.isDate) return zonedMs(keyOf(t), '00:00', fallbackTz)
  if (t.zone === ICAL.Timezone.utcTimezone) return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  const tzid = prop.getParameter('tzid') as string | undefined
  if (tzid && !isZone(tzid) && t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toJSDate().getTime()
  const zone = tzid && isZone(tzid) ? tzid : fallbackTz
  return zonedMs(keyOf(t), `${pad2(t.hour)}:${pad2(t.minute)}`, zone) + t.second * 1000
}

/** The zone a timed value is written in: 'UTC', its TZID, or null (a date, or a floating time). */
function zoneOf(prop: ICAL.Property | null): string | null {
  if (!prop) return null
  const t = prop.getFirstValue() as ICAL.Time
  if (!t || t.isDate) return null
  if (t.zone === ICAL.Timezone.utcTimezone) return 'UTC'
  const tzid = prop.getParameter('tzid') as string | undefined
  return tzid ?? null
}

/** A value for `ms` written the way `tzid` says ('UTC' → …Z, an IANA name → TZID=…, anything else → that TZID's clock via `clockTz`). */
function timeValue(ms: number, tzid: string, clockTz: string): { time: ICAL.Time; tzid: string | null } {
  if (tzid === 'UTC') return { time: ICAL.Time.fromJSDate(new Date(ms), true), tzid: null }
  const f = fieldsInZone(ms, isZone(tzid) ? tzid : clockTz)
  const time = ICAL.Time.fromData({ year: f.y, month: f.m, day: f.d, hour: f.h, minute: f.min, second: 0, isDate: false })
  return { time, tzid }
}

/** Adds a date or date-time property: a date for an all-day event, else the instant on `tzid`'s clock. */
function addTime(v: ICAL.Component, name: 'dtstart' | 'dtend' | 'recurrence-id' | 'exdate', ms: number, allDay: boolean, dateKey: DateKey, tzid: string, clockTz: string): void {
  const prop = new ICAL.Property(name)
  if (allDay) prop.setValue(ICAL.Time.fromDateString(dateKey))
  else {
    const { time, tzid: param } = timeValue(ms, tzid, clockTz)
    prop.setValue(time)
    if (param) prop.setParameter('tzid', param)
  }
  v.addProperty(prop)
}

function setTime(v: ICAL.Component, name: 'dtstart' | 'dtend' | 'recurrence-id', ms: number, allDay: boolean, dateKey: DateKey, tzid: string, clockTz: string): void {
  v.removeAllProperties(name)
  addTime(v, name, ms, allDay, dateKey, tzid, clockTz)
}

function setText(v: ICAL.Component, name: string, value: string): void {
  if (value) v.updatePropertyWithValue(name, value)
  else v.removeAllProperties(name)
}

function touch(v: ICAL.Component, now: number): void {
  const stamp = ICAL.Time.fromJSDate(new Date(now), true)
  v.updatePropertyWithValue('dtstamp', stamp)
  v.updatePropertyWithValue('last-modified', stamp)
  v.updatePropertyWithValue('sequence', Number(v.getFirstPropertyValue('sequence') ?? 0) + 1)
}

function exdateKeys(v: ICAL.Component, tz: string): Set<DateKey> {
  const out = new Set<DateKey>()
  for (const p of v.getAllProperties('exdate')) {
    for (const value of p.getValues() as ICAL.Time[]) {
      if (!value) continue
      out.add(value.isDate ? keyOf(value) : keyInZone(instantOfValue(value, p, tz), tz))
    }
  }
  return out
}

function instantOfValue(t: ICAL.Time, p: ICAL.Property, tz: string): number {
  if (t.zone === ICAL.Timezone.utcTimezone) return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  const tzid = p.getParameter('tzid') as string | undefined
  return zonedMs(keyOf(t), `${pad2(t.hour)}:${pad2(t.minute)}`, tzid && isZone(tzid) ? tzid : tz)
}

/** Which occurrence (its original day) an exception component stands for. */
function occurrenceKeyOf(v: ICAL.Component, tz: string): DateKey | null {
  const p = v.getFirstProperty('recurrence-id')
  if (!p) return null
  const t = p.getFirstValue() as ICAL.Time
  return t.isDate ? keyOf(t) : keyInZone(instantOf(p, tz), tz)
}

function newCalendar(): ICAL.Component {
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('prodid', '-//GOOYA//Calendar//EN')
  cal.updatePropertyWithValue('version', '2.0')
  cal.updatePropertyWithValue('calscale', 'GREGORIAN')
  return cal
}

/**
 * The calendar data of an iCloud event with GOOYA's version of it written in. `data` is what iCloud has now (null for
 * an event made in GOOYA). The event keeps its own time zone; occurrences deleted in GOOYA become EXDATEs and changed
 * ones become exceptions, as Apple Calendar writes them.
 */
export function applyEventToIcs(data: string | null, ev: CalendarEvent, now = Date.now()): string {
  const cal = data ? new ICAL.Component(ICAL.parse(data)) : newCalendar()
  const tz = ev.timezone || 'UTC'
  const vevents = cal.getAllSubcomponents('vevent')
  let master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) {
    master = new ICAL.Component('vevent')
    master.updatePropertyWithValue('uid', ev.iCalUID || `${randomUUID().toUpperCase()}`)
    master.updatePropertyWithValue('created', ICAL.Time.fromJSDate(new Date(now), true))
    cal.addSubcomponent(master)
  }
  const tzid = ev.allDay ? tz : (zoneOf(master.getFirstProperty('dtstart')) ?? tz)
  const uid = String(master.getFirstPropertyValue('uid') ?? ev.iCalUID)
  setText(master, 'summary', ev.title)
  setText(master, 'description', ev.notes)
  setText(master, 'location', ev.location)
  master.removeAllProperties('duration')
  setTime(master, 'dtstart', ev.start, ev.allDay, ev.startDate, tzid, tz)
  setTime(master, 'dtend', ev.end, ev.allDay, addDaysKey(ev.endDate < ev.startDate ? ev.startDate : ev.endDate, 1), tzid, tz)
  if (ev.rrule) {
    if (!master.hasProperty('rrule')) master.addPropertyWithValue('rrule', ICAL.Recur.fromString(ev.rrule))
    const startClock = fieldsInZone(ev.start, isZone(tzid) ? tzid : tz)
    const originalStart = (key: DateKey) => (ev.allDay ? zonedMs(key, '00:00', tz) : zonedMs(key, `${pad2(startClock.h)}:${pad2(startClock.min)}`, isZone(tzid) ? tzid : tz))
    const deleted = new Set([...ev.exdates, ...Object.entries(ev.overrides ?? {}).filter(([, o]) => o.cancelled).map(([k]) => k)])
    const have = exdateKeys(master, tz)
    for (const key of deleted) {
      for (const exc of cal.getAllSubcomponents('vevent')) if (exc.hasProperty('recurrence-id') && occurrenceKeyOf(exc, tz) === key) cal.removeSubcomponent(exc)
      if (!have.has(key)) addTime(master, 'exdate', originalStart(key), ev.allDay, key, tzid, tz)
    }
    for (const [key, ov] of Object.entries(ev.overrides ?? {}) as [DateKey, EventOverride][]) {
      if (ov.cancelled || deleted.has(key)) continue
      let exc = cal.getAllSubcomponents('vevent').find((v) => v.hasProperty('recurrence-id') && occurrenceKeyOf(v, tz) === key)
      if (!exc) {
        exc = new ICAL.Component('vevent')
        exc.updatePropertyWithValue('uid', uid)
        setTime(exc, 'recurrence-id', originalStart(key), ev.allDay, key, tzid, tz)
        setText(exc, 'summary', ev.title)
        setText(exc, 'description', ev.notes)
        setText(exc, 'location', ev.location)
        cal.addSubcomponent(exc)
      }
      if (ov.title != null) setText(exc, 'summary', ov.title)
      if (ov.notes != null) setText(exc, 'description', ov.notes)
      if (ov.location != null) setText(exc, 'location', ov.location)
      const s = ov.start ?? originalStart(key)
      const e = ov.end ?? s + (ev.end - ev.start)
      exc.removeAllProperties('duration')
      setTime(exc, 'dtstart', s, ev.allDay, keyInZone(s + 12 * 3600_000, tz), tzid, tz)
      setTime(exc, 'dtend', e, ev.allDay, keyInZone(e + 12 * 3600_000, tz), tzid, tz)
      touch(exc, now)
    }
  }
  touch(master, now)
  return cal.toString()
}

// ---------------------------------------------------------------- reading

export interface ParsedIcsEvent {
  uid: string
  title: string
  notes: string
  location: string
  allDay: boolean
  start: number
  end: number
  startDate: DateKey
  endDate: DateKey
  timezone: string
  rrule: string | null
  exdates: DateKey[]
  overrides: Record<DateKey, EventOverride>
  /** LAST-MODIFIED, else DTSTAMP (ms), else 0. */
  updated: number
}

/** An iCloud calendar object as a GOOYA event's fields; floating times are on `defaultTz`'s clock. */
export function parseIcsEvent(data: string, defaultTz: string): ParsedIcsEvent | null {
  let cal: ICAL.Component
  try {
    cal = new ICAL.Component(ICAL.parse(data))
  } catch {
    return null
  }
  const vevents = cal.getAllSubcomponents('vevent')
  const master = vevents.find((v) => !v.hasProperty('recurrence-id')) ?? vevents[0]
  const startProp = master?.getFirstProperty('dtstart')
  if (!master || !startProp) return null
  const startValue = startProp.getFirstValue() as ICAL.Time
  const allDay = startValue.isDate
  const tzid = zoneOf(startProp)
  const tz = tzid && tzid !== 'UTC' && isZone(tzid) ? tzid : defaultTz
  const start = instantOf(startProp, tz)
  let end: number
  const endProp = master.getFirstProperty('dtend')
  if (endProp) end = instantOf(endProp, tz)
  else {
    const dur = master.getFirstPropertyValue('duration') as ICAL.Duration | null
    end = dur ? start + dur.toSeconds() * 1000 : allDay ? zonedMs(addDaysKey(keyOf(startValue), 1), '00:00', tz) : start
  }
  const startDate = allDay ? keyOf(startValue) : keyInZone(start, tz)
  const endDate = allDay ? addDaysKey(endProp ? keyOf(endProp.getFirstValue() as ICAL.Time) : addDaysKey(startDate, 1), -1) : keyInZone(Math.max(start, end - 1), tz)
  const rrule = master.getFirstPropertyValue('rrule') as ICAL.Recur | null
  const overrides: Record<DateKey, EventOverride> = {}
  const masterNotes = String(master.getFirstPropertyValue('description') ?? '')
  const masterLocation = String(master.getFirstPropertyValue('location') ?? '')
  for (const v of vevents) {
    const key = occurrenceKeyOf(v, tz)
    if (!key) continue
    const s = v.getFirstProperty('dtstart')
    const e = v.getFirstProperty('dtend')
    const notes = String(v.getFirstPropertyValue('description') ?? '')
    const location = String(v.getFirstPropertyValue('location') ?? '')
    overrides[key] = {
      title: String(v.getFirstPropertyValue('summary') ?? ''),
      ...(s ? { start: instantOf(s, tz) } : {}),
      ...(e ? { end: instantOf(e, tz) } : {}),
      ...(notes !== masterNotes ? { notes } : {}),
      ...(location !== masterLocation ? { location } : {}),
    }
  }
  const stamp = (master.getFirstPropertyValue('last-modified') ?? master.getFirstPropertyValue('dtstamp')) as ICAL.Time | null
  return {
    uid: String(master.getFirstPropertyValue('uid') ?? ''),
    title: String(master.getFirstPropertyValue('summary') ?? '') || '(No title)',
    notes: masterNotes,
    location: masterLocation,
    allDay,
    start: allDay ? zonedMs(startDate, '00:00', tz) : start,
    end: allDay ? zonedMs(addDaysKey(endDate, 1), '00:00', tz) : end,
    startDate,
    endDate,
    timezone: tz,
    rrule: rrule ? rrule.toString() : null,
    exdates: [...exdateKeys(master, tz)],
    overrides,
    updated: stamp ? stamp.toJSDate().getTime() : 0,
  }
}

/**
 * One of GOOYA's own copies in iCloud (task-….ics / schedule-….ics) in plain values on `tz`'s clock: the copy, its
 * deleted occurrences, and its changed ones. `updated` falls back to `now` when the copy says nothing (it changed).
 */
export function copyFromIcs(data: string, tz: string, now = Date.now()): { copy: CalendarCopy; exdates: DateKey[]; occurrences: CopyOccurrence[] } | null {
  const ev = parseIcsEvent(data, tz)
  if (!ev) return null
  const hhmm = (ms: number) => {
    const f = fieldsInZone(ms, tz)
    return `${pad2(f.h)}:${pad2(f.min)}`
  }
  const updated = ev.updated || now
  const copy: CalendarCopy = {
    title: ev.title === '(No title)' ? '' : ev.title,
    notes: ev.notes,
    allDay: ev.allDay,
    startDate: ev.allDay ? ev.startDate : keyInZone(ev.start, tz),
    startTime: ev.allDay ? null : hhmm(ev.start),
    endTime: ev.allDay ? null : hhmm(ev.end),
    updated,
  }
  const occurrences: CopyOccurrence[] = Object.entries(ev.overrides).map(([dateKey, ov]) => {
    const s = ov.start ?? ev.start
    const e = ov.end ?? s + (ev.end - ev.start)
    return {
      dateKey,
      cancelled: false,
      copy: { title: ov.title ?? copy.title, notes: ov.notes ?? copy.notes, allDay: ev.allDay, startDate: ev.allDay ? keyInZone(s + 12 * 3600_000, tz) : keyInZone(s, tz), startTime: ev.allDay ? null : hhmm(s), endTime: ev.allDay ? null : hhmm(e), updated },
    }
  })
  return { copy, exdates: ev.exdates, occurrences }
}
