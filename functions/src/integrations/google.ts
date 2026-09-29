import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
// The Calendar API's own small client (the full googleapis package pushed functions past their memory limit).
import { auth as googleAuth, calendar as googleCalendar, type calendar_v3 } from '@googleapis/calendar'
import { randomUUID } from 'node:crypto'
import type { CalendarEvent, Schedule, Task } from '../../../shared/model'
import { normalizeEvent, normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, personForEmail, type PersonKey } from '../../../shared/people'
import { addDaysKey, fieldsInZone, keyInZone, zonedMs } from '../../../shared/time'
import {
  APP_URL,
  FUNCTIONS_URL,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  INTEGRATIONS_KEY,
  accountsRef,
  decrypt,
  encrypt,
  eventDocId,
  eventsRef,
  googleEventIdFor,
  personFromRequest,
  secretRef,
  shortHash,
  sign,
  type AccountDoc,
} from './common'

const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email']
const REDIRECT_URI = `${FUNCTIONS_URL}/googleAuthCallback`
const NOTIFY_URL = `${FUNCTIONS_URL}/gcalNotify`
const SECRETS = [INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET]

function oauthClient() {
  return new googleAuth.OAuth2(GOOGLE_OAUTH_CLIENT_ID.value().trim(), GOOGLE_OAUTH_CLIENT_SECRET.value().trim(), REDIRECT_URI)
}

async function calendarFor(accountId: string): Promise<calendar_v3.Calendar> {
  const secret = await secretRef(accountId).get()
  const enc = secret.data()?.refreshToken as string | undefined
  if (!enc) throw new Error('no refresh token')
  const client = oauthClient()
  client.setCredentials({ refresh_token: decrypt(enc) })
  return googleCalendar({ version: 'v3', auth: client })
}

/** Step 1: redirect the signed-in person to Google's consent screen (offline access). */
export const googleAuthStart = onRequest({ secrets: SECRETS, invoker: 'public' }, async (req, res) => {
  const person = await personFromRequest(req)
  if (!person) {
    res.status(401).send('Sign in to GOOYA first.')
    return
  }
  const nonce = randomUUID()
  // Where to return afterwards: the iPhone app (its gooya:// scheme) or the web app.
  const target = req.query.app ? 'app' : 'web'
  const state = `${person}.${nonce}.${target}.${sign(`${person}.${nonce}.${target}`)}`
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, include_granted_scopes: true })
  res.redirect(302, url)
})

/** The page the callback returns to: the app's own scheme, or the web app. */
function returnUrl(target: string, error?: string): string {
  const q = `integrations=google${error ? `&error=${encodeURIComponent(error)}` : ''}`
  return target === 'app' ? `gooya://integrations?${q}` : `${APP_URL}/?${q}`
}

/** Step 2: exchange the code, store the refresh token encrypted, list calendars, return to the app. */
export const googleAuthCallback = onRequest({ secrets: SECRETS, invoker: 'public', memory: '512MiB' }, async (req, res) => {
  const state = String(req.query.state ?? '')
  const parts = state.split('.')
  // Older states (before the app existed) have three parts; new ones carry the return target.
  const [person, nonce, target, sig] = parts.length === 4 ? parts : [parts[0], parts[1], 'web', parts[2]]
  const signed = parts.length === 4 ? `${person}.${nonce}.${target}` : `${person}.${nonce}`
  if (!person || !nonce || sig !== sign(signed) || !(person in PEOPLE)) {
    res.status(400).send('Bad state')
    return
  }
  const code = String(req.query.code ?? '')
  if (!code) {
    res.redirect(302, returnUrl(target, String(req.query.error ?? 'denied')))
    return
  }
  try {
    const client = oauthClient()
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token; remove GOOYA from your Google account permissions and connect again.')
    client.setCredentials(tokens)
    const info = await client.request<{ email?: string }>({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' })
    const email = (info.data.email ?? '').toLowerCase()
    if (!email) throw new Error('Google did not share the account email; connect again and allow it.')
    const accountId = `g_${shortHash(`${person}:${email}`, 12)}`
    await secretRef(accountId).set({ source: 'google', person, refreshToken: encrypt(tokens.refresh_token), updatedAt: Date.now() })
    const cal = googleCalendar({ version: 'v3', auth: client })
    const list = await cal.calendarList.list({ minAccessRole: 'reader' })
    const existing = (await accountsRef(person as PersonKey).doc(accountId).get()).data() as AccountDoc | undefined
    const calendars: AccountDoc['calendars'] = {}
    for (const c of list.data.items ?? []) {
      if (!c.id) continue
      const prev = existing?.calendars?.[c.id]
      calendars[c.id] = { name: c.summary ?? c.id, color: c.backgroundColor ?? '#4285f4', primary: !!c.primary, direction: prev?.direction ?? 'off', syncToken: prev?.syncToken }
    }
    const doc: AccountDoc = {
      source: 'google',
      email,
      status: 'connected',
      connectedAt: existing?.connectedAt ?? Date.now(),
      calendars,
      exportCalendarId: existing?.exportCalendarId,
      exportTasks: existing?.exportTasks ?? true,
      exportSchedules: existing?.exportSchedules ?? true,
      watch: existing?.watch ?? {},
    }
    await accountsRef(person as PersonKey).doc(accountId).set(doc)
    res.redirect(302, returnUrl(target))
  } catch (e) {
    logger.error('googleAuthCallback failed', { error: String(e) })
    res.redirect(302, returnUrl(target, String((e as Error).message ?? e)))
  }
})

// ---------------------------------------------------------------- import (Google → GOOYA)

function rruleFromGoogle(recurrence: string[] | null | undefined): { rrule: string | null; exdates: string[] } {
  let rrule: string | null = null
  const exdates: string[] = []
  for (const line of recurrence ?? []) {
    if (line.startsWith('RRULE:')) rrule = line.slice(6)
    else if (line.startsWith('EXDATE')) {
      const vals = line.split(':')[1] ?? ''
      for (const v of vals.split(',')) if (v.length >= 8) exdates.push(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`)
    }
  }
  return { rrule, exdates }
}

function toEvent(person: PersonKey, accountId: string, calendarId: string, calName: string, color: string, editable: boolean, e: calendar_v3.Schema$Event): CalendarEvent | null {
  if (!e.id) return null
  const allDay = !!e.start?.date
  const tz = e.start?.timeZone || 'UTC'
  let start: number
  let end: number
  let startDate: string
  let endDate: string
  if (allDay) {
    startDate = e.start!.date!
    const endExclusive = e.end?.date ?? addDaysKey(startDate, 1)
    endDate = addDaysKey(endExclusive, -1)
    start = zonedMs(startDate, '00:00', tz)
    end = zonedMs(endExclusive, '00:00', tz)
  } else {
    start = Date.parse(e.start?.dateTime ?? '')
    end = Date.parse(e.end?.dateTime ?? '') || start + 3600_000
    startDate = keyInZone(start, tz)
    endDate = keyInZone(Math.max(start, end - 1), tz)
  }
  if (Number.isNaN(start)) return null
  const { rrule, exdates } = rruleFromGoogle(e.recurrence)
  return {
    id: eventDocId('google', accountId, calendarId, e.id),
    owner: person,
    source: 'google',
    accountId,
    calendarId,
    calendarName: calName,
    externalId: e.id,
    iCalUID: e.iCalUID ?? '',
    title: e.summary ?? '(No title)',
    notes: e.description ?? '',
    location: e.location ?? '',
    allDay,
    start,
    end,
    startDate,
    endDate,
    timezone: tz,
    rrule,
    exdates,
    overrides: {},
    color,
    editable,
    etag: e.etag ?? '',
    updatedAt: Date.parse(e.updated ?? '') || Date.now(),
  }
}

/** Incremental sync of one calendar; returns the number of changed events. */
export async function syncGoogleCalendar(person: PersonKey, accountId: string, calendarId: string): Promise<number> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[calendarId]
  if (!acc || !cfg || (cfg.direction !== 'import' && cfg.direction !== 'both')) return 0
  const cal = await calendarFor(accountId)
  const editable = cfg.direction === 'both'
  let pageToken: string | undefined
  let syncToken = cfg.syncToken
  const masters = new Map<string, CalendarEvent>()
  const instances: calendar_v3.Schema$Event[] = []
  const deleted: string[] = []
  let changed = 0
  try {
    do {
      const res = await cal.events.list({
        calendarId,
        pageToken,
        syncToken: pageToken ? undefined : syncToken,
        singleEvents: false,
        showDeleted: true,
        maxResults: 2500,
        ...(syncToken ? {} : { timeMin: new Date(Date.now() - 120 * 86_400_000).toISOString() }),
      })
      for (const e of res.data.items ?? []) {
        if (!e.id) continue
        if (e.recurringEventId) {
          instances.push(e)
          continue
        }
        if (e.status === 'cancelled') {
          deleted.push(eventDocId('google', accountId, calendarId, e.id))
          continue
        }
        const ev = toEvent(person, accountId, calendarId, cfg.name, cfg.color, editable, e)
        if (ev) masters.set(e.id, ev)
      }
      pageToken = res.data.nextPageToken ?? undefined
      if (!pageToken) syncToken = res.data.nextSyncToken ?? syncToken
    } while (pageToken)
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 410) {
      // Sync token expired: full resync.
      await accRef.set({ calendars: { [calendarId]: { syncToken: FieldValue.delete() } } }, { merge: true })
      return syncGoogleCalendar(person, accountId, calendarId)
    }
    throw e
  }
  // Apply recurring-instance exceptions to their masters (fetch masters we did not see in this delta).
  for (const inst of instances) {
    const masterId = inst.recurringEventId!
    let master = masters.get(masterId)
    if (!master) {
      const snap = await eventsRef().doc(eventDocId('google', accountId, calendarId, masterId)).get()
      if (snap.exists) master = normalizeEvent(snap.id, snap.data() as Record<string, unknown>)
      else {
        try {
          const got = await cal.events.get({ calendarId, eventId: masterId })
          master = toEvent(person, accountId, calendarId, cfg.name, cfg.color, editable, got.data) ?? undefined
        } catch {
          master = undefined
        }
      }
      if (master) masters.set(masterId, master)
    }
    if (!master) continue
    const orig = inst.originalStartTime?.date ?? inst.originalStartTime?.dateTime
    if (!orig) continue
    const dateKey = inst.originalStartTime?.date ?? keyInZone(Date.parse(orig), master.timezone)
    if (inst.status === 'cancelled') {
      if (!master.exdates.includes(dateKey)) master.exdates = [...master.exdates, dateKey]
      delete master.overrides[dateKey]
    } else {
      const s = inst.start?.date ? zonedMs(inst.start.date, '00:00', master.timezone) : Date.parse(inst.start?.dateTime ?? '')
      const en = inst.end?.date ? zonedMs(inst.end.date, '00:00', master.timezone) : Date.parse(inst.end?.dateTime ?? '')
      master.overrides = { ...master.overrides, [dateKey]: { title: inst.summary ?? undefined, start: s || undefined, end: en || undefined } }
      master.exdates = master.exdates.filter((k) => k !== dateKey)
    }
  }
  const batch = getFirestore().batch()
  for (const ev of masters.values()) {
    const { id, ...rest } = ev
    batch.set(eventsRef().doc(id), { ...rest, dirty: false, deleted: false })
    changed++
  }
  for (const id of deleted) {
    batch.delete(eventsRef().doc(id))
    changed++
  }
  await batch.commit()
  await accRef.set({ calendars: { [calendarId]: { syncToken: syncToken ?? FieldValue.delete(), lastSync: Date.now() } }, lastSync: Date.now(), status: 'connected', error: FieldValue.delete() }, { merge: true })
  return changed
}

async function ensureWatch(person: PersonKey, accountId: string, calendarId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const w = acc?.watch?.[calendarId]
  if (w && w.expiration > Date.now() + 36 * 3600_000) return
  const cal = await calendarFor(accountId)
  const channelId = randomUUID()
  try {
    const res = await cal.events.watch({ calendarId, requestBody: { id: channelId, type: 'web_hook', address: NOTIFY_URL, token: `${person}:${accountId}:${shortHash(calendarId, 12)}` } })
    await accRef.set({ watch: { [calendarId]: { channelId, resourceId: res.data.resourceId ?? '', expiration: Number(res.data.expiration ?? Date.now() + 6 * 86_400_000) } } }, { merge: true })
    if (w?.channelId && w.resourceId) await cal.channels.stop({ requestBody: { id: w.channelId, resourceId: w.resourceId } }).catch(() => undefined)
  } catch (e) {
    logger.warn('events.watch failed (polling still runs)', { calendarId, error: String(e) })
  }
}

/** Sync every import/both calendar of an account, set up push channels, and export if enabled. */
export async function syncGoogleAccount(person: PersonKey, accountId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (!acc) return
  try {
    for (const [calId, cfg] of Object.entries(acc.calendars ?? {})) {
      if (cfg.direction === 'import' || cfg.direction === 'both') {
        await syncGoogleCalendar(person, accountId, calId)
        await ensureWatch(person, accountId, calId)
      }
    }
    if (Object.values(acc.calendars ?? {}).some((c) => c.direction === 'export' || c.direction === 'both')) await exportToGoogle(person, accountId)
  } catch (e) {
    logger.error('google sync failed', { person, accountId, error: String(e) })
    await accRef.set({ status: 'error', error: String((e as Error).message ?? e).slice(0, 300) }, { merge: true })
  }
}

/** Push notification from events.watch → sync that calendar. */
export const gcalNotify = onRequest({ secrets: SECRETS, invoker: 'public', memory: '512MiB' }, async (req, res) => {
  const token = String(req.get('x-goog-channel-token') ?? '')
  const state = String(req.get('x-goog-resource-state') ?? '')
  res.status(200).send('ok')
  if (state === 'sync' || !token) return
  const [person, accountId, calHash] = token.split(':')
  if (!(person in PEOPLE) || !accountId) return
  const acc = (await accountsRef(person as PersonKey).doc(accountId).get()).data() as AccountDoc | undefined
  const calId = Object.keys(acc?.calendars ?? {}).find((c) => shortHash(c, 12) === calHash)
  if (!calId) return
  try {
    await syncGoogleCalendar(person as PersonKey, accountId, calId)
  } catch (e) {
    logger.error('gcalNotify sync failed', { error: String(e) })
  }
})

/** 10-minute fallback poll (incremental, cheap) + watch renewal. */
export const pollGoogle = onSchedule({ schedule: '*/10 * * * *', timeZone: 'America/New_York', secrets: SECRETS, retryCount: 0, memory: '512MiB' }, async () => {
  for (const person of Object.keys(PEOPLE) as PersonKey[]) {
    const accounts = await accountsRef(person).where('source', '==', 'google').get()
    for (const a of accounts.docs) await syncGoogleAccount(person, a.id)
  }
})

// ---------------------------------------------------------------- export (GOOYA → Google "GOOYA" calendar)

async function ensureExportCalendar(person: PersonKey, accountId: string, cal: calendar_v3.Calendar): Promise<string> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (acc?.exportCalendarId) {
    try {
      await cal.calendars.get({ calendarId: acc.exportCalendarId })
      return acc.exportCalendarId
    } catch {
      /* recreate */
    }
  }
  const created = await cal.calendars.insert({ requestBody: { summary: 'GOOYA', description: 'Tasks and schedules from GOOYA', timeZone: PEOPLE[person].timezone } })
  const id = created.data.id!
  await accRef.set({ exportCalendarId: id }, { merge: true })
  return id
}

function taskToGoogle(t: Task): calendar_v3.Schema$Event | null {
  if (!t.dueDate) return null
  const tz = t.timezone || 'UTC'
  const body: calendar_v3.Schema$Event = { summary: t.title, description: t.notes || undefined, status: t.completed && !t.rrule ? 'cancelled' : 'confirmed' }
  if (t.dueTime) {
    const start = zonedMs(t.dueDate, t.dueTime, tz)
    body.start = { dateTime: new Date(start).toISOString(), timeZone: tz }
    body.end = { dateTime: new Date(start + 15 * 60_000).toISOString(), timeZone: tz }
  } else {
    body.start = { date: t.dueDate }
    body.end = { date: addDaysKey(t.dueDate, 1) }
  }
  if (t.rrule) {
    const rec = [`RRULE:${t.rrule}`]
    if (t.exdates?.length) rec.push(t.dueTime ? `EXDATE;TZID=${tz}:${t.exdates.map((d) => `${d.replace(/-/g, '')}T${t.dueTime!.replace(':', '')}00`).join(',')}` : `EXDATE;VALUE=DATE:${t.exdates.map((d) => d.replace(/-/g, '')).join(',')}`)
    body.recurrence = rec
  }
  return body
}

function scheduleToGoogle(s: Schedule): calendar_v3.Schema$Event {
  const tz = s.timezone || 'UTC'
  const start = zonedMs(s.startDate, s.startTime, tz)
  let end = zonedMs(s.startDate, s.endTime, tz)
  if (end <= start) end += 86_400_000
  const rec = [`RRULE:${s.rrule}${s.endDate && !/UNTIL/.test(s.rrule) ? `;UNTIL=${s.endDate.replace(/-/g, '')}T235959Z` : ''}`]
  if (s.exdates?.length) rec.push(`EXDATE;TZID=${tz}:${s.exdates.map((d) => `${d.replace(/-/g, '')}T${s.startTime.replace(':', '')}00`).join(',')}`)
  return {
    summary: `${s.icon ? `${s.icon} ` : ''}${s.title}`,
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    recurrence: rec,
    transparency: 'transparent',
  }
}

async function upsertGoogleEvent(cal: calendar_v3.Calendar, calendarId: string, localId: string, body: calendar_v3.Schema$Event | null): Promise<void> {
  const eventId = googleEventIdFor(localId)
  if (!body) {
    await cal.events.delete({ calendarId, eventId }).catch(() => undefined)
    return
  }
  try {
    await cal.events.update({ calendarId, eventId, requestBody: { ...body, id: eventId } })
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 404) await cal.events.insert({ calendarId, requestBody: { ...body, id: eventId } })
    else if (code === 410) await cal.events.update({ calendarId, eventId, requestBody: { ...body, id: eventId, status: 'confirmed' } }).catch(() => undefined)
    else throw e
  }
}

/** Full reconcile of the person's tasks/schedules into the GOOYA calendar. */
export async function exportToGoogle(person: PersonKey, accountId: string): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (!acc) return
  const cal = await calendarFor(accountId)
  const calendarId = await ensureExportCalendar(person, accountId, cal)
  const db = getFirestore()
  if (acc.exportTasks !== false) {
    const tasks = await db.collection('tasks').where('owner', '==', person).get()
    for (const d of tasks.docs) {
      const t = normalizeTask(d.id, d.data() as Record<string, unknown>)
      if (t.source !== 'gooya') continue
      await upsertGoogleEvent(cal, calendarId, `task:${t.id}`, taskToGoogle(t))
    }
  }
  if (acc.exportSchedules !== false) {
    const schedules = await db.collection('schedules').where('owner', '==', person).get()
    for (const d of schedules.docs) await upsertGoogleEvent(cal, calendarId, `schedule:${d.id}`, scheduleToGoogle(normalizeSchedule(d.id, d.data() as Record<string, unknown>)))
  }
}

/** Export one changed item (called from the task/schedule triggers). */
export async function exportItemToGoogle(person: PersonKey, kind: 'task' | 'schedule', id: string, item: Task | Schedule | null): Promise<void> {
  const accounts = await accountsRef(person).where('source', '==', 'google').get()
  for (const a of accounts.docs) {
    const acc = a.data() as AccountDoc
    const exporting = Object.values(acc.calendars ?? {}).some((c) => c.direction === 'export' || c.direction === 'both')
    if (!exporting) continue
    if (kind === 'task' && acc.exportTasks === false) continue
    if (kind === 'schedule' && acc.exportSchedules === false) continue
    try {
      const cal = await calendarFor(a.id)
      const calendarId = await ensureExportCalendar(person, a.id, cal)
      const body = !item ? null : kind === 'task' ? ((item as Task).source === 'gooya' ? taskToGoogle(item as Task) : null) : scheduleToGoogle(item as Schedule)
      await upsertGoogleEvent(cal, calendarId, `${kind}:${id}`, body)
    } catch (e) {
      logger.error('exportItemToGoogle failed', { person, id, error: String(e) })
    }
  }
}

// ---------------------------------------------------------------- two-way edits (GOOYA → source)

function instanceId(masterId: string, originalStart: number, allDay: boolean, tz: string): string {
  if (allDay) return `${masterId}_${keyInZone(originalStart, tz).replace(/-/g, '')}`
  const d = new Date(originalStart)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${masterId}_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** Push a locally edited (dirty) Google event back to Google. */
export async function pushGoogleEvent(ev: CalendarEvent): Promise<void> {
  const cal = await calendarFor(ev.accountId)
  if (ev.deleted) {
    await cal.events.delete({ calendarId: ev.calendarId, eventId: ev.externalId }).catch(() => undefined)
    await eventsRef().doc(ev.id).delete()
    return
  }
  const tz = ev.timezone || 'UTC'
  const base: calendar_v3.Schema$Event = { summary: ev.title, description: ev.notes || undefined, location: ev.location || undefined }
  if (ev.allDay) {
    base.start = { date: ev.startDate }
    base.end = { date: addDaysKey(ev.endDate, 1) }
  } else {
    base.start = { dateTime: new Date(ev.start).toISOString(), timeZone: tz }
    base.end = { dateTime: new Date(ev.end).toISOString(), timeZone: tz }
  }
  if (!ev.externalId) {
    const created = await cal.events.insert({ calendarId: ev.calendarId, requestBody: { ...base, recurrence: ev.rrule ? [`RRULE:${ev.rrule}`] : undefined } })
    await eventsRef().doc(ev.id).set({ externalId: created.data.id ?? '', iCalUID: created.data.iCalUID ?? '', etag: created.data.etag ?? '', dirty: false }, { merge: true })
    return
  }
  const patch: calendar_v3.Schema$Event = { ...base }
  if (ev.rrule) {
    const rec = [`RRULE:${ev.rrule}`]
    if (ev.exdates.length) rec.push(ev.allDay ? `EXDATE;VALUE=DATE:${ev.exdates.map((d) => d.replace(/-/g, '')).join(',')}` : `EXDATE;TZID=${tz}:${ev.exdates.map((d) => `${d.replace(/-/g, '')}T${String(fieldsInZone(ev.start, tz).h).padStart(2, '0')}${String(fieldsInZone(ev.start, tz).min).padStart(2, '0')}00`).join(',')}`)
    patch.recurrence = rec
  } else patch.recurrence = undefined
  await cal.events.patch({ calendarId: ev.calendarId, eventId: ev.externalId, requestBody: patch })
  // Per-occurrence overrides → instance patches.
  for (const [dateKey, ov] of Object.entries(ev.overrides ?? {})) {
    if (!ov.start && !ov.title && !ov.end) continue
    const origStart = ev.allDay ? zonedMs(dateKey, '00:00', tz) : zonedMs(dateKey, `${String(fieldsInZone(ev.start, tz).h).padStart(2, '0')}:${String(fieldsInZone(ev.start, tz).min).padStart(2, '0')}`, tz)
    const body: calendar_v3.Schema$Event = {}
    if (ov.title) body.summary = ov.title
    if (ov.start && ov.end) {
      body.start = ev.allDay ? { date: keyInZone(ov.start, tz) } : { dateTime: new Date(ov.start).toISOString(), timeZone: tz }
      body.end = ev.allDay ? { date: keyInZone(ov.end, tz) } : { dateTime: new Date(ov.end).toISOString(), timeZone: tz }
    }
    await cal.events.patch({ calendarId: ev.calendarId, eventId: instanceId(ev.externalId, origStart, ev.allDay, tz), requestBody: body }).catch((e) => logger.warn('instance patch failed', { error: String(e) }))
  }
  const fresh = await cal.events.get({ calendarId: ev.calendarId, eventId: ev.externalId })
  await eventsRef().doc(ev.id).set({ etag: fresh.data.etag ?? '', updatedAt: Date.parse(fresh.data.updated ?? '') || Date.now(), dirty: false }, { merge: true })
}

/** Callable: sync now / disconnect / set directions are done client-side on the account doc; this forces a sync. */
export const syncNow = onCall({ secrets: SECRETS, memory: '512MiB', timeoutSeconds: 300 }, async (req) => {
  const person = personForEmail(req.auth?.token.email)
  if (!person || !req.auth?.token.email_verified) throw new HttpsError('permission-denied', 'not allowed')
  const accountId = String(req.data?.accountId ?? '')
  const acc = (await accountsRef(person.key).doc(accountId).get()).data() as AccountDoc | undefined
  if (!acc) throw new HttpsError('not-found', 'account')
  if (acc.source === 'google') await syncGoogleAccount(person.key, accountId)
  else {
    const { syncAppleAccount } = await import('./apple')
    await syncAppleAccount(person.key, accountId)
  }
  return { ok: true }
})
