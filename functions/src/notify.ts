import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions'
import { normalizeUser } from '../../shared/normalize'
import { PEOPLE, type PersonKey } from '../../shared/people'
import type { Task } from '../../shared/model'
import { formatDue } from '../../shared/fmt'
import { zonedMs } from '../../shared/time'

export const APP_URL = 'https://gooya-eunbee.web.app'

export interface PushContent {
  title: string
  body: string
  url: string
  tag?: string
  taskId?: string
  dateKey?: string
}

const INVALID = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'])

/** A person's push tokens (their iPhones, and browsers from the website's time). */
async function tokensOf(person: PersonKey): Promise<string[]> {
  const snap = await getFirestore().collection('users').doc(person).get()
  const user = snap.exists ? normalizeUser(snap.id, snap.data() as Record<string, unknown>) : null
  return Array.from(new Set(user?.fcmTokens ?? [])).filter(Boolean)
}

/** Takes tokens that no longer reach a device off the person. */
async function pruneTokens(person: PersonKey, tokens: string[], res: BatchResponse, kind: string): Promise<void> {
  const dead: string[] = []
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code ?? ''
      logger.warn(`${kind} push failed`, { person, code })
      if (INVALID.has(code)) dead.push(tokens[i])
    }
  })
  if (dead.length) await getFirestore().collection('users').doc(person).update({ fcmTokens: FieldValue.arrayRemove(...dead) })
}

/** Data-only web push to every device of a person; prunes dead tokens. Returns true if any delivery succeeded. */
export async function sendToPerson(person: PersonKey, content: PushContent): Promise<boolean> {
  const tokens = await tokensOf(person)
  if (!tokens.length) {
    logger.info('no tokens', { person })
    return false
  }
  const data: Record<string, string> = { title: content.title, body: content.body, url: content.url }
  if (content.tag) data.tag = content.tag
  if (content.taskId) data.taskId = content.taskId
  if (content.dateKey) data.dateKey = content.dateKey
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data,
    webpush: { headers: { Urgency: 'high', TTL: '3600' }, fcmOptions: { link: content.url } },
    // The iPhone app: iOS shows the alert itself (the app may be closed); the data above tells the app where to go.
    apns: {
      headers: { 'apns-priority': '10', ...(content.tag ? { 'apns-collapse-id': content.tag.slice(0, 64) } : {}) },
      payload: { aps: { alert: { title: content.title, body: content.body }, sound: 'default', 'thread-id': content.tag ?? 'gooya', 'mutable-content': 1 } },
    },
  })
  await pruneTokens(person, tokens, res, 'alert')
  return res.successCount > 0
}

/**
 * A silent push that wakes a person's iPhone for a moment so it syncs its Reminders (GOOYA can reach Reminders only on
 * the iPhone). Nothing is shown. iOS decides when the app runs and allows a few such pushes an hour; pushes waiting
 * for the same phone are folded into one.
 */
export async function sendSyncPush(person: PersonKey): Promise<boolean> {
  const tokens = await tokensOf(person)
  if (!tokens.length) return false
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { kind: 'sync' },
    apns: {
      headers: { 'apns-priority': '5', 'apns-push-type': 'background', 'apns-collapse-id': 'gooya-sync' },
      payload: { aps: { contentAvailable: true } },
    },
  })
  await pruneTokens(person, tokens, res, 'sync')
  logger.info('sync push', { person, sent: res.successCount })
  return res.successCount > 0
}

/** "은비 added a task to your calendar" (respects the owner's setting). */
export async function notifyTaskAdded(task: Task): Promise<void> {
  const db = getFirestore()
  const ownerSnap = await db.collection('users').doc(task.owner).get()
  const owner = ownerSnap.exists ? normalizeUser(ownerSnap.id, ownerSnap.data() as Record<string, unknown>) : null
  if (owner?.settings?.notifyOnOtherAdds === false) return
  const creatorSnap = await db.collection('users').doc(task.createdBy).get()
  const creator = creatorSnap.exists ? normalizeUser(creatorSnap.id, creatorSnap.data() as Record<string, unknown>) : null
  const creatorName = creator?.name || PEOPLE[task.createdBy].name
  const tz = owner?.timezone || PEOPLE[task.owner].timezone
  // On the owner's clock, the day as well as the time (a task kept on another clock may be on another day there).
  const when = !task.dueDate ? 'No date' : formatDue({ allDay: !task.dueTime, dueDate: task.dueDate, start: task.dueTime ? zonedMs(task.dueDate, task.dueTime, task.timezone || tz) : 0 }, tz, Date.now())
  await sendToPerson(task.owner, {
    title: `${creatorName} added “${task.title}”`,
    body: when,
    tag: `added-${task.id}`,
    url: `${APP_URL}/?task=${encodeURIComponent(task.id)}&date=${task.dueDate ?? ''}`,
    taskId: task.id,
    dateKey: task.dueDate ?? '',
  })
}
