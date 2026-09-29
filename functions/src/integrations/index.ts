import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { normalizeEvent, normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, type PersonKey } from '../../../shared/people'
import { INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, secretRef } from './common'
import { exportItemToGoogle, pushGoogleEvent, syncGoogleAccount } from './google'
import { exportItemToApple, pushAppleEvent, syncAppleAccount } from './apple'
import type { AccountDoc } from './common'

export { googleAuthStart, googleAuthCallback, gcalNotify, pollGoogle, syncNow } from './google'
export { appleConnect, pollApple } from './apple'
export { remindersImport } from './reminders'
export { icsFeed } from './ics'

const SECRETS = [INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET]

/** Locally edited imported events are pushed back to their source. */
export const onEventWritten = onDocumentWritten({ document: 'events/{id}', secrets: SECRETS }, async (event) => {
  const after = event.data?.after
  if (!after?.exists) return
  const ev = normalizeEvent(after.id, after.data() as Record<string, unknown>)
  if (!ev.dirty || !ev.editable) return
  try {
    if (ev.source === 'google') await pushGoogleEvent(ev)
    else await pushAppleEvent(ev)
  } catch (e) {
    logger.error('push edit failed', { id: ev.id, error: String(e) })
    await after.ref.set({ dirty: false, pushError: String((e as Error).message ?? e).slice(0, 300) }, { merge: true })
  }
})

/** Export tasks/schedules on change (GOOYA → connected calendars). */
export const onTaskExport = onDocumentWritten({ document: 'tasks/{id}', secrets: SECRETS }, async (event) => {
  const after = event.data?.after
  const before = event.data?.before
  const task = after?.exists ? normalizeTask(after.id, after.data() as Record<string, unknown>) : null
  const owner = (task?.owner ?? (before?.data()?.owner as PersonKey)) as PersonKey | undefined
  if (!owner || !(owner in PEOPLE)) return
  await exportItemToGoogle(owner, 'task', event.params.id, task)
  await exportItemToApple(owner, 'task', event.params.id, task)
})

export const onScheduleExport = onDocumentWritten({ document: 'schedules/{id}', secrets: SECRETS }, async (event) => {
  const after = event.data?.after
  const before = event.data?.before
  const schedule = after?.exists ? normalizeSchedule(after.id, after.data() as Record<string, unknown>) : null
  const owner = (schedule?.owner ?? (before?.data()?.owner as PersonKey)) as PersonKey | undefined
  if (!owner || !(owner in PEOPLE)) return
  await exportItemToGoogle(owner, 'schedule', event.params.id, schedule)
  await exportItemToApple(owner, 'schedule', event.params.id, schedule)
})

/** What decides what an account syncs: each calendar's direction and the two export switches. */
function syncShape(acc: AccountDoc | undefined): string {
  if (!acc) return ''
  const dirs = Object.entries(acc.calendars ?? {})
    .map(([id, c]) => `${id}=${c.direction}`)
    .sort()
    .join(',')
  return `${dirs}|${acc.exportTasks !== false}|${acc.exportSchedules !== false}`
}

/**
 * A calendar switched to Import, Export or Two-way (or an export switch changed) syncs right away, instead of at the
 * next poll up to 10 minutes later. The sync's own writes (sync tokens, lastSync) leave the shape alone, so they do not
 * trigger another one.
 */
export const onAccountChanged = onDocumentWritten({ document: 'integrations/{person}/accounts/{accountId}', secrets: SECRETS, memory: '512MiB', timeoutSeconds: 300 }, async (event) => {
  const { person, accountId } = event.params
  if (!(person in PEOPLE)) return
  const before = event.data?.before?.data() as AccountDoc | undefined
  const after = event.data?.after?.data() as AccountDoc | undefined
  if (!after || syncShape(before) === syncShape(after)) return
  if (!Object.values(after.calendars ?? {}).some((c) => c.direction !== 'off')) return
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
