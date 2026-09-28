import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizeSchedule, normalizeTask, normalizeUser } from '../../../shared/normalize'
import type { Schedule, Task } from '../../../shared/model'
import { PEOPLE } from '../../../shared/people'
import { fieldsInZone, zonedMs } from '../../../shared/time'
import { personFromWidgetToken } from './common'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Floating local date-time in ICS form for a zone: YYYYMMDDTHHMMSS */
export function icsLocal(ms: number, tz: string): string {
  const f = fieldsInZone(ms, tz)
  return `${f.y}${pad(f.m)}${pad(f.d)}T${pad(f.h)}${pad(f.min)}00`
}

export function icsDate(key: string): string {
  return key.replace(/-/g, '')
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

export function foldLines(s: string): string {
  return s
    .split('\n')
    .map((line) => {
      const out: string[] = []
      let rest = line
      while (rest.length > 74) {
        out.push(rest.slice(0, 74))
        rest = ' ' + rest.slice(74)
      }
      out.push(rest)
      return out.join('\r\n')
    })
    .join('\r\n')
}

/** VEVENT for a task: 15-minute event at the due time, or all-day. */
export function taskToVevent(t: Task, uidSuffix = '@gooya'): string | null {
  if (!t.dueDate) return null
  const tz = t.timezone || 'UTC'
  const lines = [`BEGIN:VEVENT`, `UID:${t.id}${uidSuffix}`, `DTSTAMP:${icsLocal(t.updatedAt || Date.now(), 'UTC')}Z`, `SUMMARY:${escapeText(t.title)}`]
  if (t.notes) lines.push(`DESCRIPTION:${escapeText(t.notes)}`)
  if (t.dueTime) {
    const start = zonedMs(t.dueDate, t.dueTime, tz)
    lines.push(`DTSTART;TZID=${tz}:${icsLocal(start, tz)}`, `DTEND;TZID=${tz}:${icsLocal(start + 15 * 60_000, tz)}`)
  } else {
    const next = new Date(Date.UTC(Number(t.dueDate.slice(0, 4)), Number(t.dueDate.slice(5, 7)) - 1, Number(t.dueDate.slice(8, 10)) + 1))
    lines.push(`DTSTART;VALUE=DATE:${icsDate(t.dueDate)}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`)
  }
  if (t.rrule) lines.push(`RRULE:${t.rrule}`)
  for (const ex of t.exdates ?? []) lines.push(t.dueTime ? `EXDATE;TZID=${tz}:${icsDate(ex)}T${t.dueTime.replace(':', '')}00` : `EXDATE;VALUE=DATE:${icsDate(ex)}`)
  if (t.completed && !t.rrule) lines.push('STATUS:CANCELLED')
  lines.push('END:VEVENT')
  return lines.join('\n')
}

/** VEVENT for a schedule: recurring block in the owner's zone (may cross midnight). */
export function scheduleToVevent(s: Schedule, uidSuffix = '@gooya'): string {
  const tz = s.timezone || 'UTC'
  const start = zonedMs(s.startDate, s.startTime, tz)
  let end = zonedMs(s.startDate, s.endTime, tz)
  if (end <= start) end += 86_400_000
  const lines = [
    'BEGIN:VEVENT',
    `UID:${s.id}${uidSuffix}`,
    `DTSTAMP:${icsLocal(s.updatedAt || Date.now(), 'UTC')}Z`,
    `SUMMARY:${escapeText(`${s.icon ? `${s.icon} ` : ''}${s.title}`)}`,
    `DTSTART;TZID=${tz}:${icsLocal(start, tz)}`,
    `DTEND;TZID=${tz}:${icsLocal(end, tz)}`,
    `RRULE:${s.rrule}${s.endDate && !/UNTIL/.test(s.rrule) ? `;UNTIL=${icsDate(s.endDate)}T235959` : ''}`,
    'TRANSP:TRANSPARENT',
  ]
  for (const ex of s.exdates ?? []) lines.push(`EXDATE;TZID=${tz}:${icsDate(ex)}T${s.startTime.replace(':', '')}00`)
  lines.push('END:VEVENT')
  return lines.join('\n')
}

export function wrapCalendar(name: string, vevents: string[]): string {
  return foldLines(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GOOYA//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(name)}`, ...vevents, 'END:VCALENDAR'].join('\n')) + '\r\n'
}

/**
 * GET /icsFeed?token=… — private read-only subscription feed (webcal://) with
 * the person's tasks and schedules.
 */
export const icsFeed = onRequest({ cors: true, invoker: 'public' }, async (req, res) => {
  const person = await personFromWidgetToken(String(req.query.token ?? ''))
  if (!person) {
    res.status(403).send('invalid token')
    return
  }
  const db = getFirestore()
  const [tasksSnap, schedulesSnap, userSnap] = await Promise.all([
    db.collection('tasks').where('owner', '==', person).get(),
    db.collection('schedules').where('owner', '==', person).get(),
    db.collection('users').doc(person).get(),
  ])
  const user = userSnap.exists ? normalizeUser(userSnap.id, userSnap.data() as Record<string, unknown>) : null
  const name = `GOOYA · ${user?.name || PEOPLE[person].name}`
  const vevents: string[] = []
  for (const d of tasksSnap.docs) {
    const v = taskToVevent(normalizeTask(d.id, d.data() as Record<string, unknown>))
    if (v) vevents.push(v)
  }
  for (const d of schedulesSnap.docs) vevents.push(scheduleToVevent(normalizeSchedule(d.id, d.data() as Record<string, unknown>)))
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Cache-Control', 'private, max-age=300')
  res.send(wrapCalendar(name, vevents))
})
