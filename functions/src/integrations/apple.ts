import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav'
import ICAL from 'ical.js'
import type { CalendarEvent, Schedule, Task } from '../../../shared/model'
import { normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, personForEmail, type PersonKey } from '../../../shared/people'
import { addDaysKey, keyInZone, zonedMs } from '../../../shared/time'
import { INTEGRATIONS_KEY, accountsRef, decrypt, encrypt, eventDocId, eventsRef, secretRef, shortHash, type AccountDoc } from './common'
import { scheduleToVevent, taskToVevent, wrapCalendar } from './ics'

const ICLOUD = 'https://caldav.icloud.com'
const SECRETS = [INTEGRATIONS_KEY]

async function davClient(accountId: string) {
  const secret = (await secretRef(accountId).get()).data()
  if (!secret?.password) throw new Error('no credentials')
  return createDAVClient({
    serverUrl: ICLOUD,
    credentials: { username: secret.username as string, password: decrypt(secret.password as string) },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
}

/**
 * App-specific passwords are 16 lowercase letters that Apple shows as xxxx-xxxx-xxxx-xxxx. People type them with or
 * without the dashes, with spaces, or with a capital first letter; these are the forms worth trying, as typed first.
 */
export function appPasswordCandidates(raw: string): string[] {
  const typed = raw.trim()
  const letters = typed.replace(/[\s-]/g, '')
  const out = [typed]
  if (/^[a-z]{16}$/i.test(letters)) {
    const lower = letters.toLowerCase()
    out.push(`${lower.slice(0, 4)}-${lower.slice(4, 8)}-${lower.slice(8, 12)}-${lower.slice(12)}`, lower)
  }
  return [...new Set(out)]
}

/** Whether what was typed has the shape of an app-specific password at all (an Apple Account password usually does not). */
export const looksLikeAppPassword = (raw: string): boolean => /^[a-z]{16}$/i.test(raw.replace(/[\s-]/g, ''))

const isAuthFailure = (e: unknown) => /401|403|invalid credentials|unauthori[sz]ed/i.test(String((e as Error)?.message ?? e))

/** Connect an iCloud account with an app-specific password; lists calendars. */
export const appleConnect = onCall({ secrets: SECRETS, memory: '512MiB' }, async (req) => {
  const person = personForEmail(req.auth?.token.email)
  if (!person || !req.auth?.token.email_verified) throw new HttpsError('permission-denied', 'not allowed')
  const email = String(req.data?.email ?? '').trim().toLowerCase()
  const typed = String(req.data?.password ?? '')
  if (!email || !typed.trim()) throw new HttpsError('invalid-argument', 'Enter the email of your Apple Account and an app-specific password.')
  let calendars: DAVCalendar[] = []
  let homeUrl = ''
  let password = ''
  let lastError: unknown = null
  for (const candidate of appPasswordCandidates(typed)) {
    try {
      const client = await createDAVClient({ serverUrl: ICLOUD, credentials: { username: email, password: candidate }, authMethod: 'Basic', defaultAccountType: 'caldav' })
      calendars = await client.fetchCalendars()
      homeUrl = (client as unknown as { account?: { homeUrl?: string } }).account?.homeUrl ?? ''
      password = candidate
      break
    } catch (e) {
      lastError = e
      if (!isAuthFailure(e)) break
    }
  }
  if (!password) {
    logger.warn('appleConnect: iCloud refused the sign-in', { person: person.key, shape: looksLikeAppPassword(typed) ? 'app-password' : 'other', error: String((lastError as Error)?.message ?? lastError).slice(0, 200) })
    if (!isAuthFailure(lastError)) throw new HttpsError('unavailable', `iCloud could not be reached (${String((lastError as Error)?.message ?? lastError).slice(0, 120)}). Try again in a minute.`)
    throw new HttpsError(
      'unauthenticated',
      looksLikeAppPassword(typed)
        ? 'iCloud did not accept this email and app-specific password. Check the email is the one your Apple Account uses (iPhone Settings → your name, at the top), or make a new app-specific password and paste it here.'
        : 'That is not an app-specific password. iCloud accepts only an app-specific password here: 16 letters like abcd-efgh-ijkl-mnop, made at account.apple.com → Sign-In and Security → App-Specific Passwords. Your Apple Account password will not work.',
    )
  }
  const accountId = `a_${shortHash(`${person.key}:${email}`, 12)}`
  await secretRef(accountId).set({ source: 'apple', person: person.key, username: email, password: encrypt(password), updatedAt: Date.now() })
  const existing = (await accountsRef(person.key).doc(accountId).get()).data() as AccountDoc | undefined
  const cals: AccountDoc['calendars'] = {}
  for (const c of calendars) {
    if (!c.url) continue
    if (Array.isArray(c.components) && !c.components.includes('VEVENT')) continue
    const prev = existing?.calendars?.[shortHash(c.url, 16)]
    cals[shortHash(c.url, 16)] = { name: String(c.displayName ?? 'Calendar'), color: typeof c.calendarColor === 'string' ? c.calendarColor.slice(0, 7) : '#ff2d55', direction: prev?.direction ?? 'off', ctag: prev?.ctag, url: c.url }
  }
  const doc: AccountDoc = { source: 'apple', email, status: 'connected', connectedAt: existing?.connectedAt ?? Date.now(), calendars: cals, exportCalendarId: existing?.exportCalendarId, exportTasks: existing?.exportTasks ?? true, exportSchedules: existing?.exportSchedules ?? true, homeUrl }
  await accountsRef(person.key).doc(accountId).set(doc)
  return { accountId, calendars: Object.entries(cals).map(([id, c]) => ({ id, name: c.name, color: c.color })) }
})

// ---------------------------------------------------------------- import (iCloud → GOOYA)

function parseIcsToEvents(person: PersonKey, accountId: string, calendarId: string, calName: string, color: string, editable: boolean, obj: DAVCalendarObject): CalendarEvent | null {
  if (!obj.data || !obj.url) return null
  let comp: ICAL.Component
  try {
    comp = new ICAL.Component(ICAL.parse(obj.data))
  } catch {
    return null
  }
  const vevents = comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v))
  const master = vevents.find((v) => !v.isRecurrenceException()) ?? vevents[0]
  if (!master) return null
  const allDay = master.startDate.isDate
  const tz = master.startDate.zone?.tzid && master.startDate.zone.tzid !== 'floating' ? master.startDate.zone.tzid : PEOPLE[person].timezone
  const start = master.startDate.toJSDate().getTime()
  const end = master.endDate.toJSDate().getTime()
  const startDate = allDay ? master.startDate.toString().slice(0, 10) : keyInZone(start, tz)
  const endDate = allDay ? addDaysKey(master.endDate.toString().slice(0, 10), -1) : keyInZone(Math.max(start, end - 1), tz)
  const rruleProp = master.component.getFirstPropertyValue('rrule') as ICAL.Recur | null
  const exdates: string[] = []
  for (const p of master.component.getAllProperties('exdate')) {
    const v = p.getFirstValue() as ICAL.Time
    if (v) exdates.push(v.toString().slice(0, 10))
  }
  const overrides: CalendarEvent['overrides'] = {}
  for (const v of vevents) {
    if (!v.isRecurrenceException()) continue
    const key = v.recurrenceId.toString().slice(0, 10)
    overrides[key] = { title: v.summary ?? undefined, start: v.startDate.toJSDate().getTime(), end: v.endDate.toJSDate().getTime() }
  }
  return {
    id: eventDocId('apple', accountId, calendarId, obj.url),
    owner: person,
    source: 'apple',
    accountId,
    calendarId,
    calendarName: calName,
    externalId: obj.url,
    iCalUID: master.uid ?? '',
    title: master.summary || '(No title)',
    notes: master.description ?? '',
    location: master.location ?? '',
    allDay,
    start: allDay ? zonedMs(startDate, '00:00', tz) : start,
    end: allDay ? zonedMs(addDaysKey(endDate, 1), '00:00', tz) : end,
    startDate,
    endDate,
    timezone: tz,
    rrule: rruleProp ? rruleProp.toString() : null,
    exdates,
    overrides,
    color,
    editable,
    etag: String(obj.etag ?? ''),
    updatedAt: Date.now(),
  }
}

/** Sync one account: compare ctags, refetch changed calendars, export if enabled. */
export async function syncAppleAccount(person: PersonKey, accountId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (!acc) return
  try {
    const client = await davClient(accountId)
    const remote = await client.fetchCalendars()
    for (const [calId, cfg] of Object.entries(acc.calendars ?? {})) {
      if (cfg.direction !== 'import' && cfg.direction !== 'both') continue
      const cal = remote.find((c) => c.url && shortHash(c.url, 16) === calId)
      if (!cal) continue
      if (cfg.ctag && cal.ctag === cfg.ctag) continue
      const from = new Date(Date.now() - 120 * 86_400_000).toISOString()
      const to = new Date(Date.now() + 400 * 86_400_000).toISOString()
      const objects = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: from, end: to } })
      const existing = await eventsRef().where('accountId', '==', accountId).where('calendarId', '==', calId).get()
      const keep = new Set<string>()
      const batch = getFirestore().batch()
      for (const obj of objects) {
        const ev = parseIcsToEvents(person, accountId, calId, cfg.name, cfg.color, cfg.direction === 'both', obj)
        if (!ev) continue
        keep.add(ev.id)
        const prev = existing.docs.find((d) => d.id === ev.id)
        if (prev && prev.get('etag') === ev.etag && !prev.get('dirty')) continue
        const { id, ...rest } = ev
        batch.set(eventsRef().doc(id), { ...rest, dirty: false, deleted: false })
      }
      for (const d of existing.docs) if (!keep.has(d.id) && !d.get('dirty')) batch.delete(d.ref)
      await batch.commit()
      await accRef.set({ calendars: { [calId]: { ctag: cal.ctag ?? null, lastSync: Date.now() } } }, { merge: true })
    }
    if (Object.values(acc.calendars ?? {}).some((c) => c.direction === 'export' || c.direction === 'both')) await exportToApple(person, accountId)
    await accRef.set({ lastSync: Date.now(), status: 'connected', error: FieldValue.delete() }, { merge: true })
  } catch (e) {
    logger.error('apple sync failed', { person, accountId, error: String(e) })
    await accRef.set({ status: 'error', error: String((e as Error).message ?? e).slice(0, 300) }, { merge: true })
  }
}

/** iCloud has no push for third parties: poll every 5 minutes. */
export const pollApple = onSchedule({ schedule: '*/5 * * * *', timeZone: 'America/New_York', secrets: SECRETS, retryCount: 0, memory: '512MiB' }, async () => {
  for (const person of Object.keys(PEOPLE) as PersonKey[]) {
    const accounts = await accountsRef(person).where('source', '==', 'apple').get()
    for (const a of accounts.docs) await syncAppleAccount(person, a.id)
  }
})

// ---------------------------------------------------------------- export (GOOYA → iCloud "GOOYA" calendar)

async function ensureAppleExportCalendar(person: PersonKey, accountId: string, client: Awaited<ReturnType<typeof davClient>>): Promise<DAVCalendar> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const calendars = await client.fetchCalendars()
  const found = calendars.find((c) => (acc?.exportCalendarId && c.url === acc.exportCalendarId) || c.displayName === 'GOOYA')
  if (found) {
    if (found.url !== acc?.exportCalendarId) await accRef.set({ exportCalendarId: found.url }, { merge: true })
    return found
  }
  const home = acc?.homeUrl || (client as unknown as { account?: { homeUrl?: string } }).account?.homeUrl
  if (!home) throw new Error('no calendar home')
  const url = `${home.replace(/\/$/, '')}/gooya-${shortHash(person, 8)}/`
  await client.makeCalendar({ url, props: { displayname: 'GOOYA', 'calendar-color': '#0091ff' } })
  await accRef.set({ exportCalendarId: url }, { merge: true })
  const again = await client.fetchCalendars()
  const created = again.find((c) => c.url === url)
  if (!created) throw new Error('GOOYA calendar not created')
  return created
}

async function putIcs(client: Awaited<ReturnType<typeof davClient>>, calendar: DAVCalendar, filename: string, ics: string | null): Promise<void> {
  const url = `${calendar.url.replace(/\/$/, '')}/${filename}`
  if (!ics) {
    await client.deleteCalendarObject({ calendarObject: { url, etag: '' } }).catch(() => undefined)
    return
  }
  const res = await client.updateCalendarObject({ calendarObject: { url, data: ics, etag: '' } })
  if (!res.ok && res.status === 404) await client.createCalendarObject({ calendar, filename, iCalString: ics })
}

export async function exportToApple(person: PersonKey, accountId: string): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (!acc) return
  const client = await davClient(accountId)
  const calendar = await ensureAppleExportCalendar(person, accountId, client)
  const db = getFirestore()
  if (acc.exportTasks !== false) {
    const tasks = await db.collection('tasks').where('owner', '==', person).get()
    for (const d of tasks.docs) {
      const t = normalizeTask(d.id, d.data() as Record<string, unknown>)
      if (t.source !== 'gooya') continue
      const v = taskToVevent(t)
      await putIcs(client, calendar, `task-${t.id}.ics`, v ? wrapCalendar('GOOYA', [v]) : null)
    }
  }
  if (acc.exportSchedules !== false) {
    const schedules = await db.collection('schedules').where('owner', '==', person).get()
    for (const d of schedules.docs) await putIcs(client, calendar, `schedule-${d.id}.ics`, wrapCalendar('GOOYA', [scheduleToVevent(normalizeSchedule(d.id, d.data() as Record<string, unknown>))]))
  }
}

export async function exportItemToApple(person: PersonKey, kind: 'task' | 'schedule', id: string, item: Task | Schedule | null): Promise<void> {
  const accounts = await accountsRef(person).where('source', '==', 'apple').get()
  for (const a of accounts.docs) {
    const acc = a.data() as AccountDoc
    if (!Object.values(acc.calendars ?? {}).some((c) => c.direction === 'export' || c.direction === 'both')) continue
    if (kind === 'task' && acc.exportTasks === false) continue
    if (kind === 'schedule' && acc.exportSchedules === false) continue
    try {
      const client = await davClient(a.id)
      const calendar = await ensureAppleExportCalendar(person, a.id, client)
      let ics: string | null = null
      if (item) {
        if (kind === 'task') {
          const v = (item as Task).source === 'gooya' ? taskToVevent(item as Task) : null
          ics = v ? wrapCalendar('GOOYA', [v]) : null
        } else ics = wrapCalendar('GOOYA', [scheduleToVevent(item as Schedule)])
      }
      await putIcs(client, calendar, `${kind}-${id}.ics`, ics)
    } catch (e) {
      logger.error('exportItemToApple failed', { person, id, error: String(e) })
    }
  }
}

// ---------------------------------------------------------------- two-way edits (GOOYA → iCloud)

/** Rewrite the event's VEVENT with local edits (last-write-wins) and PUT it back. */
export async function pushAppleEvent(ev: CalendarEvent): Promise<void> {
  const client = await davClient(ev.accountId)
  if (ev.deleted) {
    await client.deleteCalendarObject({ calendarObject: { url: ev.externalId, etag: ev.etag } }).catch(() => undefined)
    await eventsRef().doc(ev.id).delete()
    return
  }
  const acc = (await accountsRef(ev.owner).doc(ev.accountId).get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[ev.calendarId]
  const calendars = await client.fetchCalendars()
  const calendar = calendars.find((c) => c.url && shortHash(c.url, 16) === ev.calendarId) ?? calendars.find((c) => c.url === cfg?.url)
  if (!calendar) throw new Error('calendar not found')
  const tz = ev.timezone || 'UTC'
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = (ms: number) => {
    const d = new Date(ms)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d)
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return `${g('year')}${g('month')}${g('day')}T${pad(Number(g('hour')) % 24)}${g('minute')}${g('second')}`
  }
  const lines = ['BEGIN:VEVENT', `UID:${ev.iCalUID || `${ev.id}@gooya`}`, `DTSTAMP:${local(Date.now())}Z`, `SUMMARY:${ev.title.replace(/\n/g, ' ')}`]
  if (ev.location) lines.push(`LOCATION:${ev.location}`)
  if (ev.notes) lines.push(`DESCRIPTION:${ev.notes.replace(/\r?\n/g, '\\n')}`)
  if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${ev.startDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDaysKey(ev.endDate, 1).replace(/-/g, '')}`)
  else lines.push(`DTSTART;TZID=${tz}:${local(ev.start)}`, `DTEND;TZID=${tz}:${local(ev.end)}`)
  if (ev.rrule) lines.push(`RRULE:${ev.rrule}`)
  for (const ex of ev.exdates) lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${ex.replace(/-/g, '')}` : `EXDATE;TZID=${tz}:${local(zonedMs(ex, `${pad(new Date(ev.start).getUTCHours())}:00`, tz)).slice(0, 8)}T${local(ev.start).slice(9)}`)
  lines.push('END:VEVENT')
  const ics = wrapCalendar('GOOYA', [lines.join('\n')])
  const url = ev.externalId || `${calendar.url.replace(/\/$/, '')}/${ev.id}.ics`
  const res = await client.updateCalendarObject({ calendarObject: { url, data: ics, etag: ev.etag } })
  if (!res.ok && res.status === 404) await client.createCalendarObject({ calendar, filename: `${ev.id}.ics`, iCalString: ics })
  const newEtag = res.headers?.get?.('etag') ?? ''
  await eventsRef().doc(ev.id).set({ externalId: url, etag: newEtag || ev.etag, dirty: false, updatedAt: Date.now() }, { merge: true })
}
