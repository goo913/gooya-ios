import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { isLegacyRoutine, normalizeEvent, normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, type PersonKey } from '../../../shared/people'
import { INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, secretRef } from './common'
import { exportItemToGoogle, pushGoogleEvent, revertGoogleEvent, syncGoogleAccount } from './google'
import { exportItemToApple, pushAppleEvent, revertAppleEvent, syncAppleAccount } from './apple'
import type { AccountDoc } from './common'

export { googleAuthStart, googleAuthCallback, gcalNotify, pollGoogle, syncNow } from './google'
export { appleConnect, pollApple } from './apple'
export { remindersImport } from './reminders'
export { icsFeed } from './ics'

const SECRETS = [INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET]

/**
 * Events changed, added or deleted in GOOYA on a two-way calendar go to Google or iCloud. When that fails, GOOYA shows
 * the calendar's version again and the event says what went wrong (pushError).
 */
export const onEventWritten = onDocumentWritten({ document: 'events/{id}', secrets: SECRETS, memory: '512MiB' }, async (event) => {
  const after = event.data?.after
  if (!after?.exists) return
  const ev = normalizeEvent(after.id, after.data() as Record<string, unknown>)
  if (!ev.dirty || !ev.editable) return
  try {
    if (ev.source === 'google') await pushGoogleEvent(ev)
    else await pushAppleEvent(ev)
  } catch (e) {
    const problem = String((e as Error).message ?? e).slice(0, 300)
    logger.error('push edit failed', { id: ev.id, error: problem })
    if (ev.source === 'google') await revertGoogleEvent(ev, problem)
    else await revertAppleEvent(ev, problem)
  }
})

/** Tasks and schedules changed in GOOYA are copied to the GOOYA calendar in the owner's Google and iCloud (when on). */
export const onTaskExport = onDocumentWritten({ document: 'tasks/{id}', secrets: SECRETS }, async (event) => {
  const after = event.data?.after
  const before = event.data?.before
  const task = after?.exists ? normalizeTask(after.id, after.data() as Record<string, unknown>) : null
  const owner = (task?.owner ?? (before?.data()?.owner as PersonKey)) as PersonKey | undefined
  if (!owner || !(owner in PEOPLE)) return
  await exportItemToGoogle(owner, 'task', event.params.id, task)
  await exportItemToApple(owner, 'task', event.params.id, task)
  // Given to the other person: the copy leaves the former owner's calendars.
  const was = before?.data()?.owner as PersonKey | undefined
  if (was && was !== owner && was in PEOPLE) {
    await exportItemToGoogle(was, 'task', event.params.id, null)
    await exportItemToApple(was, 'task', event.params.id, null)
  }
})

export const onScheduleExport = onDocumentWritten({ document: 'schedules/{id}', secrets: SECRETS }, async (event) => {
  const after = event.data?.after
  const before = event.data?.before
  const next = after?.exists ? (after.data() as Record<string, unknown>) : null
  const prev = before?.exists ? (before.data() as Record<string, unknown>) : null
  // A routine that an older build still keeps in "schedules" is never copied into a calendar.
  if ((next && isLegacyRoutine(next)) || (!next && prev && isLegacyRoutine(prev))) return
  const schedule = next ? normalizeSchedule(event.params.id, next) : null
  const owner = (schedule?.owner ?? prev?.owner) as PersonKey | undefined
  if (!owner || !(owner in PEOPLE)) return
  await exportItemToGoogle(owner, 'schedule', event.params.id, schedule)
  await exportItemToApple(owner, 'schedule', event.params.id, schedule)
  const formerOwner = prev?.owner as PersonKey | undefined
  if (formerOwner && formerOwner !== owner && formerOwner in PEOPLE) {
    await exportItemToGoogle(formerOwner, 'schedule', event.params.id, null)
    await exportItemToApple(formerOwner, 'schedule', event.params.id, null)
  }
})

/** What decides what an account syncs: each calendar's direction and the two export switches. */
function syncShape(acc: AccountDoc | undefined): string {
  if (!acc) return ''
  const dirs = Object.entries(acc.calendars ?? {})
    .map(([id, c]) => `${id}=${c.direction}`)
    .sort()
    .join(',')
  return `${dirs}|${acc.exportTasks === true}|${acc.exportSchedules === true}`
}

/**
 * A calendar switched to Import or Two-way (or off), or an export switch changed, syncs right away instead of at the
 * next poll up to 10 minutes later. The sync's own writes (sync tokens, lastSync) leave the shape alone, so they do not
 * trigger another one.
 */
export const onAccountChanged = onDocumentWritten({ document: 'integrations/{person}/accounts/{accountId}', secrets: SECRETS, memory: '512MiB', timeoutSeconds: 300 }, async (event) => {
  const { person, accountId } = event.params
  if (!(person in PEOPLE)) return
  const before = event.data?.before?.data() as AccountDoc | undefined
  const after = event.data?.after?.data() as AccountDoc | undefined
  if (!after || syncShape(before) === syncShape(after)) return
  try {
    if (after.source === 'google') await syncGoogleAccount(person as PersonKey, accountId)
    else await syncAppleAccount(person as PersonKey, accountId)
  } catch (e) {
    logger.error('sync after account change failed', { person, accountId, error: String(e) })
  }
})

/** Disconnecting an account removes its secret and imported events. */
export const onAccountDeleted = onDocumentDeleted({ document: 'integrations/{person}/accounts/{accountId}', secrets: SECRETS }, async (event) => {
  const { accountId } = event.params
  await secretRef(accountId).delete().catch(() => undefined)
  const { getFirestore } = await import('firebase-admin/firestore')
  const db = getFirestore()
  const events = await db.collection('events').where('accountId', '==', accountId).get()
  const batch = db.batch()
  for (const d of events.docs) batch.delete(d.ref)
  await batch.commit()
})
