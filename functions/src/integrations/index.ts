import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { normalizeEvent, normalizeSchedule, normalizeTask } from '../../../shared/normalize'
import { PEOPLE, type PersonKey } from '../../../shared/people'
import { INTEGRATIONS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, secretRef } from './common'
import { exportItemToGoogle, pushGoogleEvent } from './google'
import { exportItemToApple, pushAppleEvent } from './apple'

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
