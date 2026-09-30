import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav'
import { createHash, randomUUID } from 'node:crypto'
import type { CalendarEvent, Schedule, Task } from '../../../shared/model'
import { deletedInCalendar, plainNotes, scheduleChangeFromCopy, scheduleOccurrenceChange, taskChangeFromCopy, taskIsCopied, taskOccurrenceChange, type ScheduleCopy } from '../../../shared/calendarCopy'
import { scheduleAsEvent } from '../../../shared/schedules'
import { normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, personForEmail, type PersonKey } from '../../../shared/people'
import { keyInZone } from '../../../shared/time'
import { INTEGRATIONS_KEY, accountsRef, decrypt, encrypt, eventDocId, eventsRef, exporting, importing, secretRef, shortHash, twoWay, type AccountDoc, type CalendarConfig } from './common'
import { taskToVevent, wrapCalendar } from './ics'
import { applyEventToIcs, copyFromIcs, parseIcsEvent } from './icsEdit'

const ICLOUD = 'https://caldav.icloud.com'
const SECRETS = [INTEGRATIONS_KEY]

type Dav = Awaited<ReturnType<typeof createDAVClient>>
interface Credentials {
  username: string
  password: string
}

const message = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300)

async function credentialsOf(accountId: string): Promise<Credentials> {
  const secret = (await secretRef(accountId).get()).data()
  if (!secret?.password) throw new Error('no credentials')
  return { username: secret.username as string, password: decrypt(secret.password as string) }
}

const clientFor = (credentials: Credentials) => createDAVClient({ serverUrl: ICLOUD, credentials, authMethod: 'Basic', defaultAccountType: 'caldav' })

/** One calendar object, or null when iCloud no longer has it (tsdav throws on a 404 there). */
async function fetchObject(client: Dav, calendar: DAVCalendar, url: string): Promise<DAVCalendarObject | null> {
  try {
    const [obj] = await client.fetchCalendarObjects({ calendar, objectUrls: [url] })
    return obj?.data ? obj : null
  } catch (e) {
    if (/404|not found/i.test(message(e))) return null
    throw e
  }
}

/** Where the account's calendars live, and where GOOYA makes its own (found through the account's principal). */
async function homeUrlOf(client: Dav, credentials: Credentials): Promise<string> {
  const account = await client.createAccount({ account: { accountType: 'caldav', serverUrl: ICLOUD, credentials } })
  if (!account.homeUrl) throw new Error('iCloud did not say where your calendars are.')
  return account.homeUrl
}

/** A URL's path, to compare calendar URLs that iCloud gives with different hosts (caldav. and p161-caldav.). */
const pathOf = (url: string) => new URL(url).pathname.replace(/\/?$/, '/')

/**
 * The paths of the calendars GOOYA may change. iCloud grants write-content on the person's own calendars, not on
 * subscribed ones or ones shared with them for viewing.
 */
async function writablePaths(client: Dav, homeUrl: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const res = await client.propfind({ url: homeUrl, props: { 'd:current-user-privilege-set': {} }, depth: '1' })
  for (const r of res) {
    if (!r.href) continue
    const set = (r.props as { currentUserPrivilegeSet?: { privilege?: unknown } } | undefined)?.currentUserPrivilegeSet?.privilege
    const names = (Array.isArray(set) ? set : set ? [set] : []).flatMap((p) => Object.keys(p as object))
    out.set(pathOf(new URL(r.href, homeUrl).href), names.some((n) => n === 'writeContent' || n === 'write' || n === 'all'))
  }
  return out
}

/** The account's event calendars with what was chosen for each before; read-only ones can only be imported. */
function calendarsFromApple(remote: DAVCalendar[], writable: Map<string, boolean>, existing: AccountDoc | undefined): AccountDoc['calendars'] {
  const out: AccountDoc['calendars'] = {}
  const exportPath = existing?.exportCalendarId ? pathOf(existing.exportCalendarId) : null
  for (const c of remote) {
    if (!c.url) continue
    if (Array.isArray(c.components) && !c.components.includes('VEVENT')) continue
    if (exportPath && pathOf(c.url) === exportPath) continue
    const id = shortHash(c.url, 16)
    const prev = existing?.calendars?.[id]
    const canWrite = writable.get(pathOf(c.url)) ?? true
    let direction: CalendarConfig['direction'] = prev?.direction === 'import' || prev?.direction === 'both' ? prev.direction : 'off'
    if (direction === 'both' && !canWrite) direction = 'import'
    out[id] = {
      name: String(c.displayName || 'Calendar'),
      color: typeof c.calendarColor === 'string' ? c.calendarColor.slice(0, 7) : '#ff2d55',
      writable: canWrite,
      direction,
      url: c.url,
      ...(prev?.ctag && direction !== 'off' ? { ctag: prev.ctag } : {}),
      ...(prev?.syncedAs && direction !== 'off' ? { syncedAs: prev.syncedAs } : {}),
      ...(prev?.lastSync ? { lastSync: prev.lastSync } : {}),
    }
  }
  return out
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
  let client: Dav | null = null
  let password = ''
  let lastError: unknown = null
  for (const candidate of appPasswordCandidates(typed)) {
    try {
      client = await clientFor({ username: email, password: candidate })
      calendars = await client.fetchCalendars()
      password = candidate
      break
    } catch (e) {
      lastError = e
      if (!isAuthFailure(e)) break
    }
  }
  if (!password || !client) {
    logger.warn('appleConnect: iCloud refused the sign-in', { person: person.key, shape: looksLikeAppPassword(typed) ? 'app-password' : 'other', error: String((lastError as Error)?.message ?? lastError).slice(0, 200) })
    if (!isAuthFailure(lastError)) throw new HttpsError('unavailable', `iCloud could not be reached (${String((lastError as Error)?.message ?? lastError).slice(0, 120)}). Try again in a minute.`)
    throw new HttpsError(
      'unauthenticated',
      looksLikeAppPassword(typed)
        ? 'iCloud did not accept this email and app-specific password. Check the email is the one your Apple Account uses (iPhone Settings → your name, at the top), or make a new app-specific password and paste it here.'
        : 'That is not an app-specific password. iCloud accepts only an app-specific password here: 16 letters like abcd-efgh-ijkl-mnop, made at account.apple.com → Sign-In and Security → App-Specific Passwords. Your Apple Account password will not work.',
    )
  }
  const homeUrl = await homeUrlOf(client, { username: email, password })
  const writable = await writablePaths(client, homeUrl).catch(() => new Map<string, boolean>())
  const accountId = `a_${shortHash(`${person.key}:${email}`, 12)}`
  await secretRef(accountId).set({ source: 'apple', person: person.key, username: email, password: encrypt(password), updatedAt: Date.now() })
  const existing = (await accountsRef(person.key).doc(accountId).get()).data() as AccountDoc | undefined
  const cals = calendarsFromApple(calendars, writable, existing)
  const doc: AccountDoc = {
    source: 'apple',
    email,
    status: 'connected',
    connectedAt: existing?.connectedAt ?? Date.now(),
    calendars: cals,
    exportCalendarId: existing?.exportCalendarId,
    exportTasks: existing?.exportTasks ?? false,
    exportSchedules: existing?.exportSchedules ?? false,
    exportCtag: existing?.exportCtag,
    homeUrl,
  }
  await accountsRef(person.key).doc(accountId).set(doc)
  return { accountId, calendars: Object.entries(cals).map(([id, c]) => ({ id, name: c.name, color: c.color })) }
})

/** JSON with keys in order, to tell whether two maps from Firestore say the same. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

async function deleteCalendarEvents(accountId: string, calendarId: string): Promise<number> {
  const snap = await eventsRef().where('accountId', '==', accountId).where('calendarId', '==', calendarId).get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = getFirestore().batch()
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
  }
  return snap.size
}

/** Brings the account's calendar list up to date and returns the account as it is now; events of calendars gone go too. */
async function refreshAppleCalendars(person: PersonKey, accountId: string, remote: DAVCalendar[], writable: Map<string, boolean>): Promise<AccountDoc | undefined> {
  const accRef = accountsRef(person).doc(accountId)
  const { acc, removed } = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(accRef)
    const before = snap.data() as AccountDoc | undefined
    if (!before) return { acc: undefined, removed: [] as string[] }
    const calendars = calendarsFromApple(remote, writable, before)
    const removed = Object.keys(before.calendars ?? {}).filter((id) => !calendars[id])
    if (stableJson(calendars) !== stableJson(before.calendars ?? {})) tx.update(accRef, { calendars })
    return { acc: { ...before, calendars }, removed }
  })
  for (const calendarId of removed) await deleteCalendarEvents(accountId, calendarId)
  return acc
}

// ---------------------------------------------------------------- import (iCloud → GOOYA)

function eventFromObject(person: PersonKey, accountId: string, calendarId: string, cfg: Pick<CalendarConfig, 'name' | 'color'>, editable: boolean, obj: DAVCalendarObject): CalendarEvent | null {
  if (!obj.data || !obj.url) return null
  const p = parseIcsEvent(obj.data, PEOPLE[person].timezone)
  if (!p) return null
  return {
    id: eventDocId('apple', accountId, calendarId, obj.url),
    owner: person,
    source: 'apple',
    accountId,
    calendarId,
    calendarName: cfg.name,
    externalId: obj.url,
    iCalUID: p.uid,
    title: p.title,
    notes: p.notes,
    location: p.location,
    allDay: p.allDay,
    start: p.start,
    end: p.end,
    startDate: p.startDate,
    endDate: p.endDate,
    timezone: p.timezone,
    rrule: p.rrule,
    exdates: p.exdates,
    overrides: p.overrides,
    color: cfg.color,
    editable,
    etag: String(obj.etag ?? ''),
    updatedAt: p.updated || Date.now(),
  }
}

/** Refetches a calendar whose contents changed (its ctag), or was switched between Import and Two-way. */
async function importAppleCalendar(person: PersonKey, accountId: string, calId: string, cfg: CalendarConfig, client: Dav, remote: DAVCalendar[]): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const cal = remote.find((c) => c.url && shortHash(c.url, 16) === calId)
  if (!cal) return
  const mode = twoWay(cfg) ? 'both' : 'import'
  if (cfg.ctag && cal.ctag === cfg.ctag && cfg.syncedAs === mode) return
  const from = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const to = new Date(Date.now() + 400 * 86_400_000).toISOString()
  const objects = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: from, end: to } })
  const existing = await eventsRef().where('accountId', '==', accountId).where('calendarId', '==', calId).get()
  const keep = new Set<string>()
  const batch = getFirestore().batch()
  for (const obj of objects) {
    const ev = eventFromObject(person, accountId, calId, cfg, mode === 'both', obj)
    if (!ev) continue
    keep.add(ev.id)
    const prev = existing.docs.find((d) => d.id === ev.id)
    // A change made in GOOYA on its way to iCloud is not overwritten by the older version from iCloud.
    if (prev?.get('dirty')) continue
    if (prev && prev.get('etag') === ev.etag && prev.get('editable') === ev.editable) continue
    const { id, ...rest } = ev
    batch.set(eventsRef().doc(id), { ...rest, dirty: false, deleted: false })
  }
  for (const d of existing.docs) if (!keep.has(d.id) && !d.get('dirty')) batch.delete(d.ref)
  await batch.commit()
  logger.info('apple calendar fetched', { person, accountId, calendar: cfg.name, objects: objects.length, events: keep.size })
  await accRef.set({ calendars: { [calId]: { ctag: cal.ctag ?? null, syncedAs: mode, lastSync: Date.now() } } }, { merge: true })
}

/** Sync one account: calendars that changed come in, and the GOOYA calendar is kept in step both ways. */
export async function syncAppleAccount(person: PersonKey, accountId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const problems: string[] = []
  try {
    const before = (await accRef.get()).data() as AccountDoc | undefined
    if (!before) return
    const credentials = await credentialsOf(accountId)
    const client = await clientFor(credentials)
    let homeUrl = before.homeUrl
    if (!homeUrl) {
      homeUrl = await homeUrlOf(client, credentials)
      await accRef.set({ homeUrl }, { merge: true })
    }
    const remote = await client.fetchCalendars()
    const acc = await refreshAppleCalendars(person, accountId, remote, await writablePaths(client, homeUrl).catch(() => new Map<string, boolean>()))
    if (!acc) return
    for (const [calId, cfg] of Object.entries(acc.calendars ?? {})) {
      try {
        if (importing(cfg)) await importAppleCalendar(person, accountId, calId, cfg, client, remote)
        else if (cfg.ctag || cfg.lastSync) {
          // Turned off: its events leave GOOYA.
          await deleteCalendarEvents(accountId, calId)
          await accRef.set({ calendars: { [calId]: { ctag: FieldValue.delete(), syncedAs: FieldValue.delete(), lastSync: FieldValue.delete() } } }, { merge: true })
        }
      } catch (e) {
        logger.error('apple calendar sync failed', { person, accountId, calendar: cfg.name, error: message(e) })
        problems.push(`${cfg.name}: ${message(e)}`)
      }
    }
    try {
      if (exporting(acc)) {
        const calendar = await ensureAppleExportCalendar(person, accountId, client, homeUrl, remote)
        await syncAppleExport(person, accountId, client, calendar)
        await exportToApple(person, accountId, client, calendar)
      } else if (acc.exportCalendarId) await removeAppleExport(person, accountId, client)
    } catch (e) {
      logger.error('apple export failed', { person, accountId, error: message(e) })
      problems.push(`GOOYA calendar: ${message(e)}`)
    }
    await accRef.set({ lastSync: Date.now(), status: problems.length ? 'error' : 'connected', error: problems.length ? problems.join(' · ').slice(0, 300) : FieldValue.delete() }, { merge: true })
  } catch (e) {
    logger.error('apple sync failed', { person, accountId, error: String(e) })
    await accRef.set({ status: 'error', error: message(e) }, { merge: true })
  }
}

/** iCloud has no push for third parties: poll every 5 minutes. */
export const pollApple = onSchedule({ schedule: '*/5 * * * *', timeZone: 'America/New_York', secrets: SECRETS, retryCount: 0, memory: '512MiB', timeoutSeconds: 300 }, async () => {
  for (const person of Object.keys(PEOPLE) as PersonKey[]) {
    const accounts = await accountsRef(person).where('source', '==', 'apple').get()
    for (const a of accounts.docs) await syncAppleAccount(person, a.id)
  }
})

// ---------------------------------------------------------------- export (GOOYA → the "GOOYA" calendar in iCloud)

/** What was last written to the GOOYA calendar, per item ('task:<id>' → the hash of the calendar data and iCloud's etag). */
const exportStateRef = (person: PersonKey, accountId: string) => getFirestore().collection('integrations').doc(person).collection('exports').doc(accountId)
interface Written {
  h: string
  e: string
}
type CopyKind = 'task' | 'schedule'

const filenameOf = (key: string) => `${key.replace(':', '-')}.ics`
function keyOfUrl(url: string): string | null {
  const m = /\/(task|schedule)-([^/]+)\.ics$/.exec(url)
  return m ? `${m[1]}:${decodeURIComponent(m[2])}` : null
}

async function ensureAppleExportCalendar(person: PersonKey, accountId: string, client: Dav, homeUrl: string, remote: DAVCalendar[]): Promise<DAVCalendar> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const found = acc?.exportCalendarId ? remote.find((c) => c.url && pathOf(c.url) === pathOf(acc.exportCalendarId!)) : undefined
  if (found) return found
  // Made again when it was deleted in Apple Calendar; everything is then written into it again.
  const segment = `gooya-${shortHash(`${person}:${accountId}`, 8)}`
  const res = await client.makeCalendar({
    url: `${homeUrl.replace(/\/?$/, '/')}${segment}/`,
    props: {
      'd:displayname': 'GOOYA',
      'ca:calendar-color': '#0091FF',
      'c:calendar-description': 'Tasks and schedules from GOOYA. Changes made here go back to GOOYA.',
      'c:supported-calendar-component-set': { 'c:comp': { _attributes: { name: 'VEVENT' } } },
    },
  })
  if (!res.every((r) => r.ok || r.status === 405)) throw new Error(`iCloud did not make the GOOYA calendar (${res.map((r) => r.status).join(', ')}).`)
  const made = (await client.fetchCalendars()).find((c) => c.url && pathOf(c.url).endsWith(`/${segment}/`))
  if (!made) throw new Error('iCloud did not list the GOOYA calendar it made.')
  await exportStateRef(person, accountId).delete()
  await accRef.set({ exportCalendarId: made.url, exportCtag: FieldValue.delete(), calendars: { [shortHash(made.url, 16)]: FieldValue.delete() } }, { merge: true })
  return made
}

/**
 * The calendar data GOOYA writes for one item into iCloud, or null for nothing (a copy made before is taken out). Only
 * GOOYA's own tasks (Apple Reminders are in Apple Calendar already) and schedules; routines never.
 */
function icsFor(acc: AccountDoc, kind: CopyKind, item: Task | Schedule | null): string | null {
  if (!item) return null
  if (kind === 'task') {
    const t = item as Task
    const v = acc.exportTasks === true && t.source === 'gooya' && taskIsCopied(t) ? taskToVevent(t) : null
    return v ? wrapCalendar('GOOYA', [v]) : null
  }
  if (acc.exportSchedules !== true) return null
  const s = item as Schedule
  // Written as of the schedule's last change, so the same schedule always gives the same calendar data.
  return applyEventToIcs(null, scheduleAsEvent(s, '#0091ff'), s.updatedAt || s.createdAt || 0)
}

/** Items of the person that belong in iCloud's GOOYA calendar. */
async function wantedInApple(person: PersonKey, acc: AccountDoc): Promise<Map<string, string>> {
  const db = getFirestore()
  const want = new Map<string, string>()
  if (acc.exportTasks === true) {
    const tasks = await db.collection('tasks').where('owner', '==', person).get()
    for (const d of tasks.docs) {
      const ics = icsFor(acc, 'task', normalizeTask(d.id, d.data() as Record<string, unknown>))
      if (ics) want.set(`task:${d.id}`, ics)
    }
  }
  if (acc.exportSchedules === true) {
    const schedules = await db.collection('schedules').where('owner', '==', person).get()
    for (const d of schedules.docs) {
      const s = normalizeSchedule(d.id, d.data() as Record<string, unknown>)
      const ics = s && icsFor(acc, 'schedule', s)
      if (ics) want.set(`schedule:${d.id}`, ics)
    }
  }
  return want
}

const icsHash = (ics: string) => createHash('sha1').update(ics).digest('hex').slice(0, 16)

async function putCopy(client: Dav, calendar: DAVCalendar, key: string, ics: string): Promise<string> {
  const url = new URL(filenameOf(key), calendar.url.replace(/\/?$/, '/')).href
  const res = await client.updateCalendarObject({ calendarObject: { url, data: ics, etag: '' } })
  if (!res.ok) throw new Error(`iCloud refused ${filenameOf(key)} (${res.status} ${(await res.text().catch(() => '')).slice(0, 120)})`)
  return res.headers.get('etag') ?? ''
}

/** Full reconcile of the GOOYA calendar in iCloud: writes what changed, takes out what no longer belongs there. */
async function exportToApple(person: PersonKey, accountId: string, client: Dav, calendar: DAVCalendar): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (!acc) return
  const stateRef = exportStateRef(person, accountId)
  const written = ((await stateRef.get()).data()?.items ?? {}) as Record<string, Written>
  const want = await wantedInApple(person, acc)
  const updates: Record<string, Written | FieldValue> = {}
  for (const [key, ics] of want) {
    const h = icsHash(ics)
    if (written[key]?.h === h) continue
    updates[key] = { h, e: await putCopy(client, calendar, key, ics) }
  }
  for (const key of Object.keys(written)) {
    if (want.has(key)) continue
    await client.deleteCalendarObject({ calendarObject: { url: new URL(filenameOf(key), calendar.url.replace(/\/?$/, '/')).href, etag: '' } }).catch(() => undefined)
    updates[key] = FieldValue.delete()
  }
  if (Object.keys(updates).length) await stateRef.set({ items: updates }, { merge: true })
}

/** Export turned off: the GOOYA calendar goes away from iCloud. */
async function removeAppleExport(person: PersonKey, accountId: string, client: Dav): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (acc?.exportCalendarId) await client.davRequest({ url: acc.exportCalendarId, init: { method: 'DELETE', namespace: 'd', body: '' } }).catch(() => undefined)
  await exportStateRef(person, accountId).delete()
  await accountsRef(person).doc(accountId).set({ exportCalendarId: FieldValue.delete(), exportCtag: FieldValue.delete() }, { merge: true })
}

/** Export one changed item (called from the task and schedule triggers). */
export async function exportItemToApple(person: PersonKey, kind: CopyKind, id: string, item: Task | Schedule | null): Promise<void> {
  const accounts = await accountsRef(person).where('source', '==', 'apple').get()
  for (const a of accounts.docs) {
    const acc = a.data() as AccountDoc
    if (!exporting(acc) || !acc.exportCalendarId) continue
    const key = `${kind}:${id}`
    const ics = icsFor(acc, kind, item)
    const stateRef = exportStateRef(person, a.id)
    try {
      const written = (await stateRef.get()).get(new FieldPath('items', key)) as Written | undefined
      if (ics && written?.h === icsHash(ics)) continue
      if (!ics && !written) continue
      const client = await clientFor(await credentialsOf(a.id))
      const calendar = { url: acc.exportCalendarId } as DAVCalendar
      if (ics) await stateRef.set({ items: { [key]: { h: icsHash(ics), e: await putCopy(client, calendar, key, ics) } } }, { merge: true })
      else {
        await client.deleteCalendarObject({ calendarObject: { url: new URL(filenameOf(key), acc.exportCalendarId.replace(/\/?$/, '/')).href, etag: '' } }).catch(() => undefined)
        await stateRef.update(new FieldPath('items', key), FieldValue.delete())
      }
    } catch (e) {
      logger.error('exportItemToApple failed', { person, id, error: message(e) })
    }
  }
}

// ---------------------------------------------------------------- changes made in the GOOYA calendar (iCloud → GOOYA)

/** An iCloud copy of a schedule in plain values: the schedule itself, its deleted days and its changed ones. */
function scheduleCopyFromIcs(data: string, tz: string, now: number): { copy: ScheduleCopy; exdates: string[]; occurrences: { dateKey: string; copy: ScheduleCopy }[] } | null {
  const p = parseIcsEvent(data, tz)
  if (!p) return null
  const updated = p.updated || now
  const copy: ScheduleCopy = { title: p.title === '(No title)' ? '' : p.title, notes: p.notes, location: p.location, allDay: p.allDay, start: p.start, end: p.end, startDate: p.startDate, endDate: p.endDate, updated }
  const occurrences = Object.entries(p.overrides).map(([dateKey, ov]) => {
    const s = ov.start ?? p.start
    const e = ov.end ?? s + (p.end - p.start)
    return {
      dateKey,
      copy: { ...copy, title: ov.title ?? copy.title, notes: ov.notes ?? copy.notes, location: ov.location ?? copy.location, start: s, end: e, startDate: keyInZone(s, tz), endDate: keyInZone(Math.max(s, e - 1), tz) },
    }
  })
  return { copy, exdates: p.exdates, occurrences }
}

/**
 * Reads the GOOYA calendar when iCloud says it changed, and applies changes people made there (in Apple Calendar on a
 * phone or Mac) to the tasks and schedules the copies stand for. GOOYA knows its own writes by their etags. An event
 * added to the GOOYA calendar becomes a new schedule.
 */
async function syncAppleExport(person: PersonKey, accountId: string, client: Dav, calendar: DAVCalendar): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (!acc || (calendar.ctag && calendar.ctag === acc.exportCtag)) return
  const stateRef = exportStateRef(person, accountId)
  const written = ((await stateRef.get()).data()?.items ?? {}) as Record<string, Written>
  const first = !acc.exportCtag
  const objects = await client.fetchCalendarObjects({ calendar })
  const db = getFirestore()
  // Only what GOOYA copies there now can be changed or deleted from there (not routines or reminders from before).
  const [tasksSnap, schedulesSnap] = await Promise.all([db.collection('tasks').where('owner', '==', person).get(), db.collection('schedules').where('owner', '==', person).get()])
  const items = new Map<string, Task | Schedule>()
  for (const d of tasksSnap.docs) {
    const t = normalizeTask(d.id, d.data() as Record<string, unknown>)
    if (icsFor(acc, 'task', t)) items.set(`task:${d.id}`, t)
  }
  for (const d of schedulesSnap.docs) {
    const x = normalizeSchedule(d.id, d.data() as Record<string, unknown>)
    if (x && icsFor(acc, 'schedule', x)) items.set(`schedule:${d.id}`, x)
  }
  const seen = new Set<string>()
  const etags: Record<string, Written | FieldValue> = {}
  const now = Date.now()
  for (const obj of objects) {
    if (!obj.url || !obj.data) continue
    const key = keyOfUrl(obj.url)
    try {
      if (!key) {
        if (first) continue
        // Something added to the GOOYA calendar in Apple Calendar: it becomes a GOOYA schedule (written back as one).
        const tz = PEOPLE[person].timezone
        const c = scheduleCopyFromIcs(obj.data, tz, now)
        if (!c || !c.copy.title.trim()) continue
        // The id comes from the event, so two syncs reading the same change make one schedule.
        const ref = db.collection('schedules').doc(`is_${shortHash(`${person}:${obj.url}`, 20)}`)
        if ((await ref.get()).exists) continue
        const parsed = parseIcsEvent(obj.data, tz)
        await ref.create({
          owner: person, createdBy: person, title: c.copy.title.trim(), notes: plainNotes(c.copy.notes), location: c.copy.location, allDay: c.copy.allDay, start: c.copy.start,
          end: c.copy.end, startDate: c.copy.startDate, endDate: c.copy.endDate, timezone: parsed?.timezone ?? tz, rrule: parsed?.rrule ?? null, exdates: [], overrides: {},
          createdAt: now, updatedAt: now,
        })
        await client.deleteCalendarObject({ calendarObject: { url: obj.url, etag: '' } }).catch(() => undefined)
        logger.info('apple copy: new schedule from the GOOYA calendar', { person, schedule: ref.id })
        continue
      }
      seen.add(key)
      const was = written[key]
      if (!was || was.e === obj.etag || first) continue
      const item = items.get(key)
      if (!item) continue
      const kind: CopyKind = key.startsWith('task:') ? 'task' : 'schedule'
      const tz = item.timezone || PEOPLE[person].timezone
      let current = item
      let changed = false
      const apply = (patch: Partial<Task> | Partial<Schedule> | null) => {
        if (!patch) return
        current = { ...current, ...patch } as Task | Schedule
        changed = true
      }
      if (kind === 'task') {
        const c = copyFromIcs(obj.data, tz, now)
        if (!c) continue
        apply(taskChangeFromCopy(current as Task, c.copy))
        for (const dateKey of c.exdates) apply(taskOccurrenceChange(current as Task, { dateKey, cancelled: true }))
        for (const o of c.occurrences) apply(taskOccurrenceChange(current as Task, o))
      } else {
        const c = scheduleCopyFromIcs(obj.data, tz, now)
        if (!c) continue
        apply(scheduleChangeFromCopy(current as Schedule, c.copy))
        for (const dateKey of c.exdates) apply(scheduleOccurrenceChange(current as Schedule, { dateKey, cancelled: true }))
        for (const o of c.occurrences) apply(scheduleOccurrenceChange(current as Schedule, { dateKey: o.dateKey, cancelled: false, copy: o.copy }))
      }
      // Known now, so it is not read again until it changes. When GOOYA takes the change, what it would write for the
      // item now counts as written: the copy stays as the person left it in Apple Calendar.
      let h = was.h
      if (changed) {
        const { id: _id, ...fields } = current
        void _id
        const next = { ...current, updatedAt: now } as Task & Schedule
        const ics = icsFor(acc, kind, next)
        if (ics) h = icsHash(ics)
        await stateRef.set({ items: { [key]: { h, e: String(obj.etag ?? '') } } }, { merge: true })
        await db.collection(kind === 'task' ? 'tasks' : 'schedules').doc(item.id).set({ ...fields, updatedAt: now }, { merge: true })
        logger.info('apple copy: changed in Apple Calendar', { person, key })
      }
      etags[key] = { h, e: String(obj.etag ?? '') }
    } catch (e) {
      logger.error('apple copy: could not apply a change', { person, url: obj.url, error: message(e) })
    }
  }
  if (!first) {
    for (const key of Object.keys(written)) {
      if (seen.has(key)) continue
      const item = items.get(key) ?? null
      const kind: CopyKind = key.startsWith('task:') ? 'task' : 'schedule'
      if (deletedInCalendar(item as Task | Schedule | null, kind)) {
        await db.collection(kind === 'task' ? 'tasks' : 'schedules').doc(key.slice(key.indexOf(':') + 1)).delete()
        logger.info('apple copy: deleted in Apple Calendar', { person, key })
      }
      etags[key] = FieldValue.delete()
    }
  }
  if (Object.keys(etags).length) await stateRef.set({ items: etags }, { merge: true })
  await accRef.set({ exportCtag: calendar.ctag ?? FieldValue.delete() }, { merge: true })
}

// ---------------------------------------------------------------- two-way edits (GOOYA → iCloud)

/**
 * Sends a change made in GOOYA to an event of a two-way iCloud calendar: the event's calendar data is changed in place
 * (applyEventToIcs), and written only if nobody changed it meanwhile (If-Match); then GOOYA takes iCloud's result.
 */
export async function pushAppleEvent(ev: CalendarEvent): Promise<void> {
  const acc = (await accountsRef(ev.owner).doc(ev.accountId).get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[ev.calendarId]
  if (!cfg || !twoWay(cfg)) throw new Error('This calendar is not two-way any more.')
  const client = await clientFor(await credentialsOf(ev.accountId))
  if (ev.deleted) {
    if (ev.externalId) await client.deleteCalendarObject({ calendarObject: { url: ev.externalId, etag: '' } }).catch(() => undefined)
    await eventsRef().doc(ev.id).delete()
    return
  }
  const calendars = await client.fetchCalendars()
  const calendar = calendars.find((c) => c.url && shortHash(c.url, 16) === ev.calendarId)
  if (!calendar) throw new Error('calendar not found')
  let url = ev.externalId
  for (let attempt = 1; ; attempt++) {
    let res: Response
    if (url) {
      const current = await fetchObject(client, calendar, url)
      if (!current?.data) {
        // Deleted in iCloud meanwhile: that wins.
        await eventsRef().doc(ev.id).delete()
        return
      }
      res = await client.updateCalendarObject({ calendarObject: { url, data: applyEventToIcs(current.data, ev), etag: String(current.etag ?? '') } })
    } else {
      const filename = `${randomUUID().toUpperCase()}.ics`
      res = await client.createCalendarObject({ calendar, filename, iCalString: applyEventToIcs(null, ev) })
      if (res.ok) url = new URL(filename, calendar.url.replace(/\/?$/, '/')).href
    }
    if (res.ok) break
    // Changed in iCloud since it was read: apply the change again on the newest version.
    if (res.status === 412 && attempt < 3) continue
    throw new Error(`iCloud refused the change (${res.status}).`)
  }
  const fresh = await fetchObject(client, calendar, url)
  const imported = fresh ? eventFromObject(ev.owner, ev.accountId, ev.calendarId, cfg, true, fresh) : null
  if (!imported) return
  const { id, ...rest } = imported
  await eventsRef().doc(id).set({ ...rest, dirty: false, deleted: false })
  if (id !== ev.id) await eventsRef().doc(ev.id).delete()
}

/** A change that could not be sent: GOOYA shows iCloud's version again, with what went wrong. */
export async function revertAppleEvent(ev: CalendarEvent, problem: string): Promise<void> {
  const acc = (await accountsRef(ev.owner).doc(ev.accountId).get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[ev.calendarId]
  if (!ev.externalId || !cfg) {
    await eventsRef().doc(ev.id).delete()
    return
  }
  try {
    const client = await clientFor(await credentialsOf(ev.accountId))
    const calendar = (await client.fetchCalendars()).find((c) => c.url && shortHash(c.url, 16) === ev.calendarId)
    const obj = calendar ? await fetchObject(client, calendar, ev.externalId) : null
    const fresh = obj ? eventFromObject(ev.owner, ev.accountId, ev.calendarId, cfg, twoWay(cfg), obj) : null
    if (!fresh) {
      await eventsRef().doc(ev.id).delete()
      return
    }
    const { id, ...rest } = fresh
    await eventsRef().doc(id).set({ ...rest, dirty: false, deleted: false, pushError: problem })
  } catch {
    await eventsRef().doc(ev.id).set({ dirty: false, deleted: false, pushError: problem }, { merge: true })
  }
}
