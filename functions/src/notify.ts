import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions'
import { normalizeUser } from '../../shared/normalize'
import { PEOPLE, type PersonKey } from '../../shared/people'
import type { Task } from '../../shared/model'
import { formatShortDate, formatTime12 } from '../../shared/fmt'
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

/** Data-only web push to every device of a person; prunes dead tokens. Returns true if any delivery succeeded. */
export async function sendToPerson(person: PersonKey, content: PushContent): Promise<boolean> {
  const db = getFirestore()
  const ref = db.collection('users').doc(person)
  const snap = await ref.get()
  const user = snap.exists ? normalizeUser(snap.id, snap.data() as Record<string, unknown>) : null
  const tokens = Array.from(new Set(user?.fcmTokens ?? [])).filter(Boolean)
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
  })
  const dead: string[] = []
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code ?? ''
      logger.warn('push failed', { person, code })
      if (INVALID.has(code)) dead.push(tokens[i])
    }
  })
  if (dead.length) await ref.update({ fcmTokens: FieldValue.arrayRemove(...dead) })
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
  const when = !task.dueDate
    ? 'No date'
    : task.dueTime
      ? `${formatShortDate(task.dueDate)} · ${formatTime12(zonedMs(task.dueDate, task.dueTime, task.timezone || tz), tz)}`
      : formatShortDate(task.dueDate)
  await sendToPerson(task.owner, {
    title: `${creatorName} added “${task.title}”`,
    body: when,
    tag: `added-${task.id}`,
    url: `${APP_URL}/?task=${encodeURIComponent(task.id)}&date=${task.dueDate ?? ''}`,
    taskId: task.id,
    dateKey: task.dueDate ?? '',
  })
}
