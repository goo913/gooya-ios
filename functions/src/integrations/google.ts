import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
// The Calendar API's own small client (the full googleapis package pushed functions past their memory limit).
import { auth as googleAuth, calendar as googleCalendar, type calendar_v3 } from '@googleapis/calendar'
import { createHash, randomUUID } from 'node:crypto'
import type { CalendarEvent, Schedule, Task } from '../../../shared/model'
import { deletedInCalendar, scheduleChangeFromCopy, scheduleOccurrenceChange, scheduleTitle, taskChangeFromCopy, taskIsCopied, taskOccurrenceChange, type CalendarCopy } from '../../../shared/calendarCopy'
import { normalizeEvent, normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, personForEmail, type PersonKey } from '../../../shared/people'
import { addDaysKey, fieldsInZone, keyInZone, pad2, zonedMs } from '../../../shared/time'
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
  exporting,
  googleEventIdFor,
  importing,
  personFromRequest,
  secretRef,
  shortHash,
  sign,
  twoWay,
  type AccountDoc,
  type CalendarConfig,
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

const codeOf = (e: unknown): number | undefined => (e as { code?: number; status?: number }).code ?? (e as { status?: number }).status
const message = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Google limits how fast one person's calendar can be written: wait and try again when it says so. */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const limited = codeOf(e) === 429 || (codeOf(e) === 403 && /rate limit|quota/i.test(message(e)))
      if (!limited || attempt >= 5) throw e
      await sleep(1000 * 2 ** attempt + Math.random() * 500)
    }
  }
}

/** Deleting what is already gone is fine. */
const gone = (e: unknown) => {
  if (codeOf(e) === 404 || codeOf(e) === 410) return
  throw e
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

/**
 * The account's calendars as Google lists them, with what was chosen for each before. Calendars GOOYA may not change
 * (holidays, calendars shared for viewing) can only be imported; GOOYA's own export calendar is not offered at all.
 */
function calendarsFromGoogle(items: calendar_v3.Schema$CalendarListEntry[], existing: AccountDoc | undefined): AccountDoc['calendars'] {
  const out: AccountDoc['calendars'] = {}
  for (const c of items) {
    if (!c.id || c.id === existing?.exportCalendarId) continue
    const prev = existing?.calendars?.[c.id]
    const writable = c.accessRole === 'owner' || c.accessRole === 'writer'
    // 'export' was a direction before the export became a per-account switch.
    let direction: CalendarConfig['direction'] = prev?.direction === 'import' || prev?.direction === 'both' ? prev.direction : 'off'
    if (direction === 'both' && !writable) direction = 'import'
    out[c.id] = {
      name: c.summaryOverride || c.summary || c.id,
      color: c.backgroundColor ?? '#4285f4',
      primary: !!c.primary,
      writable,
      direction,
      ...(c.timeZone ? { timeZone: c.timeZone } : {}),
      ...(prev?.syncToken && direction !== 'off' ? { syncToken: prev.syncToken } : {}),
      ...(prev?.syncedAs && direction !== 'off' ? { syncedAs: prev.syncedAs } : {}),
      ...(prev?.lastSync ? { lastSync: prev.lastSync } : {}),
      ...(prev?.noPush ? { noPush: true } : {}),
    }
  }
  return out
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
    const doc: AccountDoc = {
      source: 'google',
      email,
      status: 'connected',
      connectedAt: existing?.connectedAt ?? Date.now(),
      calendars: calendarsFromGoogle(list.data.items ?? [], existing),
      exportCalendarId: existing?.exportCalendarId,
      exportTasks: existing?.exportTasks ?? false,
      exportSchedules: existing?.exportSchedules ?? false,
      exportSyncToken: existing?.exportSyncToken,
      watch: existing?.watch ?? {},
    }
    await accountsRef(person as PersonKey).doc(accountId).set(doc)
    res.redirect(302, returnUrl(target))
  } catch (e) {
    logger.error('googleAuthCallback failed', { error: String(e) })
    res.redirect(302, returnUrl(target, message(e)))
  }
})

/**
 * Brings the account's calendar list up to date (a calendar added, renamed, recoloured, shared read-only or removed in
 * Google) and returns the account as it is now. Events of a calendar that is gone leave GOOYA.
 */
async function refreshGoogleCalendars(person: PersonKey, accountId: string, cal: calendar_v3.Calendar): Promise<AccountDoc | undefined> {
  const list = await cal.calendarList.list({ minAccessRole: 'reader' })
  const accRef = accountsRef(person).doc(accountId)
  const { acc, removed } = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(accRef)
    const before = snap.data() as AccountDoc | undefined
    if (!before) return { acc: undefined, removed: [] as string[] }
    const calendars = calendarsFromGoogle(list.data.items ?? [], before)
    const removed = Object.keys(before.calendars ?? {}).filter((id) => !calendars[id])
    if (stableJson(calendars) !== stableJson(before.calendars ?? {})) tx.update(accRef, { calendars })
    return { acc: { ...before, calendars }, removed }
  })
  for (const calendarId of removed) await deleteCalendarEvents(accountId, calendarId)
  return acc
}

/** JSON with keys in order, to tell whether two maps from Firestore say the same. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

async function deleteCalendarEvents(accountId: string, calendarId: string): Promise<void> {
  const snap = await eventsRef().where('accountId', '==', accountId).where('calendarId', '==', calendarId).get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = getFirestore().batch()
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
  }
}

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

/** A Google event as a GOOYA event. `zone` is the calendar's time zone, for events that do not name their own. */
function toEvent(person: PersonKey, accountId: string, calendarId: string, cfg: Pick<CalendarConfig, 'name' | 'color' | 'timeZone'>, editable: boolean, e: calendar_v3.Schema$Event): CalendarEvent | null {
  if (!e.id) return null
  const allDay = !!e.start?.date
  const tz = e.start?.timeZone || cfg.timeZone || PEOPLE[person].timezone
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
    calendarName: cfg.name,
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
    color: cfg.color,
    editable,
    etag: e.etag ?? '',
    updatedAt: Date.parse(e.updated ?? '') || Date.now(),
  }
}

/** The day an occurrence of a repeating event was on before it was changed. */
function occurrenceKey(inst: calendar_v3.Schema$Event, tz: string): string | null {
  const orig = inst.originalStartTime?.date ?? inst.originalStartTime?.dateTime
  if (!orig) return null
  return inst.originalStartTime?.date ?? keyInZone(Date.parse(orig), tz)
}

/** Incremental sync of one calendar; returns the number of changed events. */
export async function syncGoogleCalendar(person: PersonKey, accountId: string, calendarId: string, cal?: calendar_v3.Calendar): Promise<number> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[calendarId]
  if (!acc || !cfg || !importing(cfg)) return 0
  cal ??= await calendarFor(accountId)
  const editable = twoWay(cfg)
  const mode = editable ? 'both' : 'import'
  let pageToken: string | undefined
  // Switched between Import and Two-way: every event is read again, so all of them say whether they can be changed.
  let syncToken = cfg.syncedAs === mode ? cfg.syncToken : undefined
  const masters = new Map<string, CalendarEvent>()
  const instances: calendar_v3.Schema$Event[] = []
  const deleted: string[] = []
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
        const ev = toEvent(person, accountId, calendarId, cfg, editable, e)
        if (ev) masters.set(e.id, ev)
      }
      pageToken = res.data.nextPageToken ?? undefined
      if (!pageToken) syncToken = res.data.nextSyncToken ?? syncToken
    } while (pageToken)
  } catch (e) {
    if (codeOf(e) === 410 && syncToken) {
      // Sync token expired: full resync.
      await accRef.set({ calendars: { [calendarId]: { syncToken: FieldValue.delete() } } }, { merge: true })
      return syncGoogleCalendar(person, accountId, calendarId, cal)
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
          master = toEvent(person, accountId, calendarId, cfg, editable, got.data) ?? undefined
        } catch {
          master = undefined
        }
      }
      if (master) masters.set(masterId, master)
    }
    if (!master) continue
    const dateKey = occurrenceKey(inst, master.timezone)
    if (!dateKey) continue
    if (inst.status === 'cancelled') {
      if (!master.exdates.includes(dateKey)) master.exdates = [...master.exdates, dateKey]
      delete master.overrides[dateKey]
    } else {
      const s = inst.start?.date ? zonedMs(inst.start.date, '00:00', master.timezone) : Date.parse(inst.start?.dateTime ?? '')
      const en = inst.end?.date ? zonedMs(inst.end.date, '00:00', master.timezone) : Date.parse(inst.end?.dateTime ?? '')
      master.overrides = {
        ...master.overrides,
        [dateKey]: {
          title: inst.summary ?? undefined,
          start: s || undefined,
          end: en || undefined,
          ...(inst.description != null && inst.description !== master.notes ? { notes: inst.description } : {}),
          ...(inst.location != null && inst.location !== master.location ? { location: inst.location } : {}),
        },
      }
      master.exdates = master.exdates.filter((k) => k !== dateKey)
    }
  }
  // A change made in GOOYA that is on its way to Google is not overwritten by the older version from Google.
  const ids = [...[...masters.values()].map((m) => m.id), ...deleted]
  const pending = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await getFirestore().getAll(...ids.slice(i, i + 300).map((id) => eventsRef().doc(id)))
    for (const s of snaps) if (s.exists && s.get('dirty')) pending.add(s.id)
  }
  let changed = 0
  let batch = getFirestore().batch()
  let n = 0
  const flush = async () => {
    if (n) await batch.commit()
    batch = getFirestore().batch()
    n = 0
  }
  for (const ev of masters.values()) {
    if (pending.has(ev.id)) continue
    const { id, ...rest } = ev
    batch.set(eventsRef().doc(id), { ...rest, dirty: false, deleted: false })
    changed++
    if (++n >= 400) await flush()
  }
  for (const id of deleted) {
    batch.delete(eventsRef().doc(id))
    changed++
    if (++n >= 400) await flush()
  }
  await flush()
  await accRef.set({ calendars: { [calendarId]: { syncToken: syncToken ?? FieldValue.delete(), syncedAs: mode, lastSync: Date.now() } } }, { merge: true })
  return changed
}

async function ensureWatch(person: PersonKey, accountId: string, calendarId: string, cal: calendar_v3.Calendar): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[calendarId]
  if (cfg?.noPush) return
  const w = acc?.watch?.[calendarId]
  if (w && w.expiration > Date.now() + 36 * 3600_000) return
  const channelId = randomUUID()
  try {
    const res = await cal.events.watch({ calendarId, requestBody: { id: channelId, type: 'web_hook', address: NOTIFY_URL, token: `${person}:${accountId}:${shortHash(calendarId, 12)}` } })
    await accRef.set({ watch: { [calendarId]: { channelId, resourceId: res.data.resourceId ?? '', expiration: Number(res.data.expiration ?? Date.now() + 6 * 86_400_000) } } }, { merge: true })
    if (w?.channelId && w.resourceId) await cal.channels.stop({ requestBody: { id: w.channelId, resourceId: w.resourceId } }).catch(() => undefined)
  } catch (e) {
    // Holiday and other public calendars cannot notify; they are polled every 10 minutes instead.
    if (/not supported/i.test(message(e)) && cfg) await accRef.set({ calendars: { [calendarId]: { noPush: true } } }, { merge: true })
    else logger.warn('events.watch failed (polling still runs)', { calendarId, error: message(e) })
  }
}

/** A calendar turned off: its events leave GOOYA and Google stops notifying about it. */
async function stopGoogleCalendar(person: PersonKey, accountId: string, calendarId: string, cal: calendar_v3.Calendar, acc: AccountDoc): Promise<void> {
  await deleteCalendarEvents(accountId, calendarId)
  const w = acc.watch?.[calendarId]
  if (w?.channelId && w.resourceId) await cal.channels.stop({ requestBody: { id: w.channelId, resourceId: w.resourceId } }).catch(() => undefined)
  await accountsRef(person)
    .doc(accountId)
    .set({ calendars: { [calendarId]: { syncToken: FieldValue.delete(), syncedAs: FieldValue.delete(), lastSync: FieldValue.delete() } }, watch: { [calendarId]: FieldValue.delete() } }, { merge: true })
}

/** Sync every imported calendar, set up push channels, and keep the GOOYA calendar in step both ways. */
export async function syncGoogleAccount(person: PersonKey, accountId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const problems: string[] = []
  try {
    const cal = await calendarFor(accountId)
    const acc = await refreshGoogleCalendars(person, accountId, cal)
    if (!acc) return
    for (const [calId, cfg] of Object.entries(acc.calendars ?? {})) {
      try {
        if (importing(cfg)) {
          await syncGoogleCalendar(person, accountId, calId, cal)
          await ensureWatch(person, accountId, calId, cal)
        } else if (cfg.syncToken || cfg.lastSync || acc.watch?.[calId]) await stopGoogleCalendar(person, accountId, calId, cal, acc)
      } catch (e) {
        logger.error('google calendar sync failed', { person, accountId, calendar: cfg.name, error: message(e) })
        problems.push(`${cfg.name}: ${message(e)}`)
      }
    }
    try {
      if (exporting(acc)) {
        const calendarId = await ensureExportCalendar(person, accountId, cal)
        await syncGoogleExport(person, accountId, cal, calendarId)
        await exportToGoogle(person, accountId, cal)
        await ensureWatch(person, accountId, calendarId, cal)
      } else if (acc.exportCalendarId) await removeGoogleExport(person, accountId, cal)
    } catch (e) {
      logger.error('google export failed', { person, accountId, error: message(e) })
      problems.push(`GOOYA calendar: ${message(e)}`)
    }
    await accRef.set({ lastSync: Date.now(), status: problems.length ? 'error' : 'connected', error: problems.length ? problems.join(' · ').slice(0, 300) : FieldValue.delete() }, { merge: true })
  } catch (e) {
    logger.error('google sync failed', { person, accountId, error: message(e) })
    await accRef.set({ status: 'error', error: message(e) }, { merge: true })
  }
}

/**
 * Push notification from events.watch → sync that calendar (or read the changes made to the GOOYA calendar). The work
 * is done before answering: a function may be stopped as soon as it has answered.
 */
export const gcalNotify = onRequest({ secrets: SECRETS, invoker: 'public', memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
  const token = String(req.get('x-goog-channel-token') ?? '')
  const state = String(req.get('x-goog-resource-state') ?? '')
  const [person, accountId, calHash] = token.split(':')
  if (state !== 'sync' && token && person in PEOPLE && accountId) {
    try {
      const acc = (await accountsRef(person as PersonKey).doc(accountId).get()).data() as AccountDoc | undefined
      if (acc?.exportCalendarId && shortHash(acc.exportCalendarId, 12) === calHash) {
        if (exporting(acc)) await syncGoogleExport(person as PersonKey, accountId, await calendarFor(accountId), acc.exportCalendarId)
      } else {
        const calId = Object.keys(acc?.calendars ?? {}).find((c) => shortHash(c, 12) === calHash)
        if (calId) await syncGoogleCalendar(person as PersonKey, accountId, calId)
      }
    } catch (e) {
      logger.error('gcalNotify sync failed', { error: message(e) })
    }
  }
  res.status(200).send('ok')
})

/** 10-minute fallback poll (incremental, cheap) + watch renewal. */
export const pollGoogle = onSchedule({ schedule: '*/10 * * * *', timeZone: 'America/New_York', secrets: SECRETS, retryCount: 0, memory: '512MiB', timeoutSeconds: 300 }, async () => {
  for (const person of Object.keys(PEOPLE) as PersonKey[]) {
    const accounts = await accountsRef(person).where('source', '==', 'google').get()
    for (const a of accounts.docs) await syncGoogleAccount(person, a.id)
  }
})

// ---------------------------------------------------------------- export (GOOYA → the "GOOYA" calendar in Google)

/**
 * What was last written to the GOOYA calendar, per item ('task:<id>' / 'schedule:<id>' → a hash of the event), so a
 * sync writes only what changed and knows what to take out.
 */
const exportStateRef = (person: PersonKey, accountId: string) => getFirestore().collection('integrations').doc(person).collection('exports').doc(accountId)

async function ensureExportCalendar(person: PersonKey, accountId: string, cal: calendar_v3.Calendar): Promise<string> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (acc?.exportCalendarId) {
    try {
      await cal.calendars.get({ calendarId: acc.exportCalendarId })
      return acc.exportCalendarId
    } catch (e) {
      if (codeOf(e) !== 404 && codeOf(e) !== 410) throw e
      // Deleted in Google: make it again and write everything into it.
    }
  }
  const created = await cal.calendars.insert({ requestBody: { summary: 'GOOYA', description: 'Tasks and schedules from GOOYA. Changes made here go back to GOOYA.', timeZone: PEOPLE[person].timezone } })
  const id = created.data.id!
  await exportStateRef(person, accountId).delete()
  await accRef.set({ exportCalendarId: id, exportSyncToken: FieldValue.delete(), calendars: { [id]: FieldValue.delete() } }, { merge: true })
  return id
}

const gooyaProps = (kind: 'task' | 'schedule', id: string) => ({ private: { gooyaKind: kind, gooyaId: id } })

function taskToGoogle(t: Task): calendar_v3.Schema$Event | null {
  if (!taskIsCopied(t) || !t.dueDate) return null
  const tz = t.timezone || 'UTC'
  const body: calendar_v3.Schema$Event = { summary: t.title, description: t.notes || '', extendedProperties: gooyaProps('task', t.id), transparency: 'transparent' }
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
    summary: scheduleTitle(s),
    description: '',
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    recurrence: rec,
    transparency: 'transparent',
    extendedProperties: gooyaProps('schedule', s.id),
  }
}

const bodyHash = (body: calendar_v3.Schema$Event) => createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16)

async function upsertGoogleEvent(cal: calendar_v3.Calendar, calendarId: string, key: string, body: calendar_v3.Schema$Event): Promise<void> {
  const eventId = googleEventIdFor(key)
  try {
    // Updating also brings back an event deleted before (Google keeps the id; inserting it again would be refused).
    await withBackoff(() => cal.events.update({ calendarId, eventId, requestBody: { ...body, id: eventId, status: 'confirmed' } }))
  } catch (e) {
    if (codeOf(e) !== 404) throw e
    await withBackoff(() => cal.events.insert({ calendarId, requestBody: { ...body, id: eventId } }))
  }
}

const deleteGoogleEvent = (cal: calendar_v3.Calendar, calendarId: string, key: string) => withBackoff(() => cal.events.delete({ calendarId, eventId: googleEventIdFor(key) })).catch(gone)

/** Items of the person that belong in the GOOYA calendar, as Google events. */
async function wantedInGoogle(person: PersonKey, acc: AccountDoc): Promise<Map<string, calendar_v3.Schema$Event>> {
  const db = getFirestore()
  const want = new Map<string, calendar_v3.Schema$Event>()
  if (acc.exportTasks === true) {
    const tasks = await db.collection('tasks').where('owner', '==', person).get()
    for (const d of tasks.docs) {
      const body = taskToGoogle(normalizeTask(d.id, d.data() as Record<string, unknown>))
      if (body) want.set(`task:${d.id}`, body)
    }
  }
  if (acc.exportSchedules === true) {
    const schedules = await db.collection('schedules').where('owner', '==', person).get()
    for (const d of schedules.docs) want.set(`schedule:${d.id}`, scheduleToGoogle(normalizeSchedule(d.id, d.data() as Record<string, unknown>)))
  }
  return want
}

/** Full reconcile of the GOOYA calendar with the person's tasks and schedules: writes what changed, takes out the rest. */
export async function exportToGoogle(person: PersonKey, accountId: string, cal?: calendar_v3.Calendar): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (!acc || !exporting(acc)) return
  cal ??= await calendarFor(accountId)
  const calendarId = await ensureExportCalendar(person, accountId, cal)
  const stateRef = exportStateRef(person, accountId)
  const written = ((await stateRef.get()).data()?.items ?? {}) as Record<string, string>
  const want = await wantedInGoogle(person, acc)
  // Written a few at a time and remembered as it goes, so a limit or a timeout halfway loses nothing.
  let updates: Record<string, string | FieldValue> = {}
  const save = async () => {
    if (Object.keys(updates).length) await stateRef.set({ items: updates }, { merge: true })
    updates = {}
  }
  for (const [key, body] of want) {
    const hash = bodyHash(body)
    if (written[key] === hash) continue
    await upsertGoogleEvent(cal, calendarId, key, body)
    updates[key] = hash
    if (Object.keys(updates).length >= 10) await save()
    await sleep(150)
  }
  for (const key of Object.keys(written)) {
    if (want.has(key)) continue
    await deleteGoogleEvent(cal, calendarId, key)
    updates[key] = FieldValue.delete()
    if (Object.keys(updates).length >= 10) await save()
    await sleep(150)
  }
  await save()
}

/** Export turned off: the GOOYA calendar goes away from the Google account. */
async function removeGoogleExport(person: PersonKey, accountId: string, cal: calendar_v3.Calendar): Promise<void> {
  const acc = (await accountsRef(person).doc(accountId).get()).data() as AccountDoc | undefined
  if (acc?.exportCalendarId) await cal.calendars.delete({ calendarId: acc.exportCalendarId }).catch(gone)
  await exportStateRef(person, accountId).delete()
  await accountsRef(person).doc(accountId).set({ exportCalendarId: FieldValue.delete(), exportSyncToken: FieldValue.delete(), watch: { [acc?.exportCalendarId ?? '-']: FieldValue.delete() } }, { merge: true })
}

/** Export one changed item (called from the task/schedule triggers). */
export async function exportItemToGoogle(person: PersonKey, kind: 'task' | 'schedule', id: string, item: Task | Schedule | null): Promise<void> {
  const accounts = await accountsRef(person).where('source', '==', 'google').get()
  for (const a of accounts.docs) {
    const acc = a.data() as AccountDoc
    if (!exporting(acc) || !acc.exportCalendarId) continue
    const on = kind === 'task' ? acc.exportTasks === true : acc.exportSchedules === true
    const key = `${kind}:${id}`
    const body = !item || !on ? null : kind === 'task' ? taskToGoogle(item as Task) : scheduleToGoogle(item as Schedule)
    const stateRef = exportStateRef(person, a.id)
    try {
      const written = (await stateRef.get()).get(new FieldPath('items', key)) as string | undefined
      if (body) {
        const hash = bodyHash(body)
        if (written === hash) continue
        await upsertGoogleEvent(await calendarFor(a.id), acc.exportCalendarId, key, body)
        await stateRef.set({ items: { [key]: hash } }, { merge: true })
      } else if (written) {
        await deleteGoogleEvent(await calendarFor(a.id), acc.exportCalendarId, key)
        await stateRef.update(new FieldPath('items', key), FieldValue.delete())
      }
    } catch (e) {
      logger.error('exportItemToGoogle failed', { person, id, error: message(e) })
    }
  }
}

// ---------------------------------------------------------------- changes made in the GOOYA calendar (Google → GOOYA)

/** A Google event of the GOOYA calendar in plain values, on the clock of the item it copies. */
function copyOf(e: calendar_v3.Schema$Event, tz: string): CalendarCopy | null {
  const allDay = !!e.start?.date
  const updated = Date.parse(e.updated ?? '') || Date.now()
  if (allDay) return { title: e.summary ?? '', notes: e.description ?? '', allDay, startDate: e.start!.date!, startTime: null, endTime: null, updated }
  const start = Date.parse(e.start?.dateTime ?? '')
  const end = Date.parse(e.end?.dateTime ?? '')
  if (Number.isNaN(start)) return null
  const hhmm = (ms: number) => {
    const f = fieldsInZone(ms, tz)
    return `${pad2(f.h)}:${pad2(f.min)}`
  }
  return { title: e.summary ?? '', notes: e.description ?? '', allDay, startDate: keyInZone(start, tz), startTime: hhmm(start), endTime: Number.isNaN(end) ? null : hhmm(end), updated }
}

/**
 * Reads what changed in the GOOYA calendar since last time and applies changes made there by people (moved, renamed,
 * notes, deleted) to the tasks and schedules they copy. GOOYA's own writes come back too; they match what GOOYA has and
 * change nothing. An event added to the GOOYA calendar becomes a new task.
 */
async function syncGoogleExport(person: PersonKey, accountId: string, cal: calendar_v3.Calendar, calendarId: string): Promise<void> {
  const accRef = accountsRef(person).doc(accountId)
  const acc = (await accRef.get()).data() as AccountDoc | undefined
  if (!acc) return
  let syncToken = acc.exportSyncToken
  const first = !syncToken
  let pageToken: string | undefined
  const items: calendar_v3.Schema$Event[] = []
  try {
    do {
      const res = await cal.events.list({ calendarId, pageToken, syncToken: pageToken ? undefined : syncToken, showDeleted: true, singleEvents: false, maxResults: 2500 })
      items.push(...(res.data.items ?? []))
      pageToken = res.data.nextPageToken ?? undefined
      if (!pageToken) syncToken = res.data.nextSyncToken ?? syncToken
    } while (pageToken)
  } catch (e) {
    if (codeOf(e) === 410 && syncToken) {
      await accRef.set({ exportSyncToken: FieldValue.delete() }, { merge: true })
      return syncGoogleExport(person, accountId, cal, calendarId)
    }
    throw e
  }
  // The first read only learns where the calendar is: everything in it was written by GOOYA.
  if (!first && items.length) await applyGoogleCopies(person, accountId, cal, calendarId, items)
  await accRef.set({ exportSyncToken: syncToken ?? FieldValue.delete() }, { merge: true })
}

async function applyGoogleCopies(person: PersonKey, accountId: string, cal: calendar_v3.Calendar, calendarId: string, items: calendar_v3.Schema$Event[]): Promise<void> {
  const db = getFirestore()
  const [tasksSnap, schedulesSnap] = await Promise.all([db.collection('tasks').where('owner', '==', person).get(), db.collection('schedules').where('owner', '==', person).get()])
  const byEventId = new Map<string, { kind: 'task' | 'schedule'; item: Task | Schedule }>()
  for (const d of tasksSnap.docs) byEventId.set(googleEventIdFor(`task:${d.id}`), { kind: 'task', item: normalizeTask(d.id, d.data() as Record<string, unknown>) })
  for (const d of schedulesSnap.docs) byEventId.set(googleEventIdFor(`schedule:${d.id}`), { kind: 'schedule', item: normalizeSchedule(d.id, d.data() as Record<string, unknown>) })
  const now = Date.now()
  const stateRef = exportStateRef(person, accountId)
  /**
   * Saves a change made in Google to the task or schedule. What GOOYA would write for it now is marked as written, so
   * the copy in Google stays as the person left it (a longer event, say) instead of being written over.
   */
  const takeCopy = async (kind: 'task' | 'schedule', item: Task | Schedule, patch: Partial<Task> | Partial<Schedule>) => {
    const next = { ...item, ...patch, updatedAt: now } as Task & Schedule
    const body = kind === 'task' ? taskToGoogle(next) : scheduleToGoogle(next)
    if (body) await stateRef.set({ items: { [`${kind}:${item.id}`]: bodyHash(body) } }, { merge: true })
    await db.collection(kind === 'task' ? 'tasks' : 'schedules').doc(item.id).update({ ...patch, updatedAt: now })
  }
  for (const e of items) {
    if (!e.id) continue
    const masterId = e.recurringEventId ?? e.id
    const found = byEventId.get(masterId)
    try {
      if (!found) {
        // Something added to the GOOYA calendar in Google: it becomes a GOOYA task (and is written back as one).
        if (e.recurringEventId || e.status === 'cancelled' || e.extendedProperties?.private?.gooyaId) continue
        const tz = PEOPLE[person].timezone
        const c = copyOf(e, tz)
        if (!c || !c.title.trim()) continue
        // The id comes from the event, so two syncs reading the same change make one task.
        const ref = db.collection('tasks').doc(`gc_${shortHash(`${person}:${e.id}`, 20)}`)
        if ((await ref.get()).exists) continue
        await ref.create({
          owner: person, createdBy: person, listId: 'tasks', title: c.title.trim(), notes: c.notes, dueDate: c.startDate, dueTime: c.allDay ? null : c.startTime, timezone: tz,
          rrule: null, exdates: [], overrides: {}, completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false, priority: 0, source: 'gooya',
          externalRefs: [], createdAt: now, updatedAt: now,
        })
        await cal.events.delete({ calendarId, eventId: e.id }).catch(gone)
        logger.info('google copy: new task from the GOOYA calendar', { person, task: ref.id })
        continue
      }
      const { kind, item } = found
      const tz = item.timezone || PEOPLE[person].timezone
      const ref = db.collection(kind === 'task' ? 'tasks' : 'schedules').doc(item.id)
      if (e.recurringEventId) {
        const dateKey = occurrenceKey(e, tz)
        if (!dateKey) continue
        const occ = { dateKey, cancelled: e.status === 'cancelled', copy: copyOf(e, tz) ?? undefined }
        const patch = kind === 'task' ? taskOccurrenceChange(item as Task, occ) : scheduleOccurrenceChange(item as Schedule, occ)
        if (patch) await takeCopy(kind, item, patch)
        continue
      }
      if (e.status === 'cancelled') {
        if (deletedInCalendar(item, kind)) {
          await ref.delete()
          logger.info('google copy: deleted in Google', { person, kind, id: item.id })
        }
        continue
      }
      const c = copyOf(e, tz)
      if (!c) continue
      const patch = kind === 'task' ? taskChangeFromCopy(item as Task, c) : scheduleChangeFromCopy(item as Schedule, c)
      if (patch) {
        await takeCopy(kind, item, patch)
        logger.info('google copy: changed in Google', { person, kind, id: item.id, fields: Object.keys(patch) })
      }
    } catch (err) {
      logger.error('google copy: could not apply a change', { person, event: e.id, error: message(err) })
    }
  }
}

// ---------------------------------------------------------------- two-way edits (GOOYA → the calendar the event came from)

function googleTimes(allDay: boolean, start: number, end: number, tz: string): Pick<calendar_v3.Schema$Event, 'start' | 'end'> {
  if (allDay) {
    const startDate = keyInZone(start + 12 * 3600_000, tz)
    const lastDate = keyInZone(end - 12 * 3600_000, tz)
    return { start: { date: startDate }, end: { date: addDaysKey(lastDate < startDate ? startDate : lastDate, 1) } }
  }
  return { start: { dateTime: new Date(start).toISOString(), timeZone: tz }, end: { dateTime: new Date(end).toISOString(), timeZone: tz } }
}

const sameTimes = (a: calendar_v3.Schema$Event, b: Pick<calendar_v3.Schema$Event, 'start' | 'end'>) =>
  (a.start?.date ?? null) === (b.start?.date ?? null) &&
  (a.end?.date ?? null) === (b.end?.date ?? null) &&
  (a.start?.dateTime ? Date.parse(a.start.dateTime) : null) === (b.start?.dateTime ? Date.parse(b.start.dateTime) : null) &&
  (a.end?.dateTime ? Date.parse(a.end.dateTime) : null) === (b.end?.dateTime ? Date.parse(b.end.dateTime) : null)

/** The instance of a repeating Google event that was on `dateKey`. */
async function findInstance(cal: calendar_v3.Calendar, calendarId: string, masterId: string, dateKey: string, tz: string): Promise<calendar_v3.Schema$Event | null> {
  const from = zonedMs(addDaysKey(dateKey, -1), '00:00', tz)
  const to = zonedMs(addDaysKey(dateKey, 2), '00:00', tz)
  const res = await cal.events.instances({ calendarId, eventId: masterId, timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), showDeleted: true, maxResults: 50 })
  return (res.data.items ?? []).find((i) => occurrenceKey(i, tz) === dateKey) ?? null
}

/**
 * Sends a change made in GOOYA to an event of a two-way calendar: only what differs from Google's version is written
 * (so attendees, reminders and everything GOOYA does not show stay as they are), then GOOYA takes Google's result.
 */
export async function pushGoogleEvent(ev: CalendarEvent): Promise<void> {
  const cal = await calendarFor(ev.accountId)
  const calendarId = ev.calendarId
  const acc = (await accountsRef(ev.owner).doc(ev.accountId).get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[calendarId]
  if (!cfg || !twoWay(cfg)) throw new Error('This calendar is not two-way any more.')
  if (ev.deleted) {
    if (ev.externalId) await cal.events.delete({ calendarId, eventId: ev.externalId }).catch(gone)
    await eventsRef().doc(ev.id).delete()
    return
  }
  const tz = ev.timezone || cfg.timeZone || PEOPLE[ev.owner].timezone
  const times = ev.allDay ? { start: { date: ev.startDate }, end: { date: addDaysKey(ev.endDate < ev.startDate ? ev.startDate : ev.endDate, 1) } } : googleTimes(false, ev.start, ev.end, tz)
  const wanted: calendar_v3.Schema$Event = { summary: ev.title, description: ev.notes || '', location: ev.location || '', ...times }
  let master: calendar_v3.Schema$Event
  if (!ev.externalId) {
    master = (await cal.events.insert({ calendarId, requestBody: { ...wanted, ...(ev.rrule ? { recurrence: [`RRULE:${ev.rrule}`] } : {}) } })).data
  } else {
    const current = (await cal.events.get({ calendarId, eventId: ev.externalId })).data
    const patch: calendar_v3.Schema$Event = {}
    if ((current.summary ?? '') !== wanted.summary) patch.summary = wanted.summary
    if ((current.description ?? '') !== wanted.description) patch.description = wanted.description
    if ((current.location ?? '') !== wanted.location) patch.location = wanted.location
    if (!sameTimes(current, wanted)) {
      patch.start = wanted.start
      patch.end = wanted.end
    }
    master = Object.keys(patch).length ? (await cal.events.patch({ calendarId, eventId: ev.externalId, requestBody: patch })).data : current
    if (ev.rrule && master.id) {
      for (const dateKey of ev.exdates) {
        const inst = await findInstance(cal, calendarId, master.id, dateKey, tz)
        if (inst?.id && inst.status !== 'cancelled') await cal.events.delete({ calendarId, eventId: inst.id }).catch(gone)
      }
      for (const [dateKey, ov] of Object.entries(ev.overrides ?? {})) {
        const inst = await findInstance(cal, calendarId, master.id, dateKey, tz)
        if (!inst?.id || inst.status === 'cancelled') continue
        const body: calendar_v3.Schema$Event = {}
        if (ov.title != null && ov.title !== (inst.summary ?? '')) body.summary = ov.title
        if (ov.notes != null && ov.notes !== (inst.description ?? '')) body.description = ov.notes
        if (ov.location != null && ov.location !== (inst.location ?? '')) body.location = ov.location
        if (ov.start != null) {
          const times = googleTimes(ev.allDay, ov.start, ov.end ?? ov.start + (ev.end - ev.start), tz)
          if (!sameTimes(inst, times)) Object.assign(body, times)
        }
        if (Object.keys(body).length) await cal.events.patch({ calendarId, eventId: inst.id, requestBody: body })
      }
    }
  }
  const imported = toEvent(ev.owner, ev.accountId, calendarId, cfg, true, master)
  if (!imported) return
  const { id, ...rest } = imported
  // A new event lives under the id the import gives it from now on.
  await eventsRef().doc(id).set({ ...rest, exdates: ev.externalId ? ev.exdates : rest.exdates, overrides: ev.externalId ? ev.overrides : {}, dirty: false, deleted: false })
  if (id !== ev.id) await eventsRef().doc(ev.id).delete()
}

/** A change that could not be sent: GOOYA shows Google's version again, with what went wrong. */
export async function revertGoogleEvent(ev: CalendarEvent, problem: string): Promise<void> {
  const acc = (await accountsRef(ev.owner).doc(ev.accountId).get()).data() as AccountDoc | undefined
  const cfg = acc?.calendars?.[ev.calendarId]
  if (!ev.externalId || !cfg) {
    await eventsRef().doc(ev.id).delete()
    return
  }
  try {
    const got = await (await calendarFor(ev.accountId)).events.get({ calendarId: ev.calendarId, eventId: ev.externalId })
    const fresh = got.data.status === 'cancelled' ? null : toEvent(ev.owner, ev.accountId, ev.calendarId, cfg, twoWay(cfg), got.data)
    if (!fresh) {
      await eventsRef().doc(ev.id).delete()
      return
    }
    const { id, ...rest } = fresh
    await eventsRef().doc(id).set({ ...rest, exdates: ev.rrule ? ev.exdates : rest.exdates, overrides: ev.rrule ? ev.overrides : {}, dirty: false, deleted: false, pushError: problem })
  } catch (e) {
    if (codeOf(e) === 404 || codeOf(e) === 410) await eventsRef().doc(ev.id).delete()
    else await eventsRef().doc(ev.id).set({ dirty: false, deleted: false, pushError: problem }, { merge: true })
  }
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
  const after = (await accountsRef(person.key).doc(accountId).get()).data() as AccountDoc | undefined
  return { ok: after?.status !== 'error', error: after?.error ?? null }
})
