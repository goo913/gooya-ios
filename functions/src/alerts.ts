import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { expandTask } from '../../shared/recurrence'
import { normalizeTask, normalizeUser } from '../../shared/normalize'
import type { Task, TaskOccurrence } from '../../shared/model'
import { DAY_MS } from '../../shared/time'
import { formatDue } from '../../shared/fmt'
import { PEOPLE } from '../../shared/people'
import { APP_URL, sendToPerson } from './notify'

const WINDOW_DAYS = 14
const GRACE_MS = 30 * 60_000

interface QueueEntry {
  taskId: string
  owner: string
  dateKey: string
  offsetMin: number
  fireAt: number
  occurrenceStart: number
  sent: boolean
}

function queueId(taskId: string, dateKey: string, offsetMin: number): string {
  return `${taskId}_${dateKey}_${offsetMin}`
}

/**
 * Alert instants for a task's occurrences in the rolling window: the due-time
 * alert itself (offset 0; 9:00 AM for date-only tasks) plus early reminders.
 * A task that is one of its owner's Apple Reminders gets no due-time alert from
 * GOOYA: Reminders alerts at the due time on the owner's iPhone already.
 */
export function desiredEntries(task: Task, now = Date.now()): Map<string, QueueEntry> {
  const out = new Map<string, QueueEntry>()
  if (!task.dueDate) return out
  const early = (task.earlyReminders ?? []).filter((a) => typeof a === 'number' && a > 0)
  const alerts = task.source === 'apple-reminders' ? early : [0, ...early]
  const rangeStart = now - GRACE_MS - 8 * DAY_MS // alerts up to a week ahead of far-off occurrences
  const rangeEnd = now + WINDOW_DAYS * DAY_MS
  const occurrences: TaskOccurrence[] = expandTask(task, rangeStart, rangeEnd + 8 * DAY_MS)
  for (const occ of occurrences) {
    if (occ.completed) continue
    const base = occ.start
    for (const offset of alerts) {
      const fireAt = base - offset * 60_000
      if (fireAt < now - GRACE_MS || fireAt > rangeEnd) continue
      const id = queueId(task.id, occ.dateKey, offset)
      out.set(id, { taskId: task.id, owner: task.owner, dateKey: occ.dateKey, offsetMin: offset, fireAt, occurrenceStart: occ.start, sent: false })
    }
  }
  return out
}

/** Reconcile alertQueue entries for one task (deleted task → remove all). */
export async function rebuildQueueForTask(taskId: string, task: Task | null): Promise<void> {
  const db = getFirestore()
  const col = db.collection('alertQueue')
  const existing = await col.where('taskId', '==', taskId).get()
  const desired = task ? desiredEntries(task) : new Map<string, QueueEntry>()
  const batch = db.batch()
  let ops = 0
  const seen = new Set<string>()
  for (const doc of existing.docs) {
    seen.add(doc.id)
    const want = desired.get(doc.id)
    const cur = doc.data() as QueueEntry
    if (!want) {
      batch.delete(doc.ref)
      ops++
      continue
    }
    if (cur.fireAt !== want.fireAt || cur.occurrenceStart !== want.occurrenceStart) {
      // Time changed: fire again if the new time is still ahead.
      batch.set(doc.ref, { ...want, sent: want.fireAt <= Date.now() - GRACE_MS ? true : false })
      ops++
    }
  }
  for (const [id, entry] of desired) {
    if (seen.has(id)) continue
    batch.set(col.doc(id), entry)
    ops++
  }
  if (ops) await batch.commit()
}

/** Rebuild queues for every task that has alerts (daily window extension). */
export async function extendQueues(): Promise<number> {
  const db = getFirestore()
  const snap = await db.collection('tasks').get()
  let n = 0
  for (const doc of snap.docs) {
    const task = normalizeTask(doc.id, doc.data() as Record<string, unknown>)
    if (!task.dueDate) continue
    await rebuildQueueForTask(task.id, task)
    n++
  }
  return n
}

/** Send due alerts (claims entries first so overlapping runs don't double-send). */
export async function sendDueAlerts(): Promise<number> {
  const db = getFirestore()
  const now = Date.now()
  const due = await db.collection('alertQueue').where('sent', '==', false).where('fireAt', '<=', now).orderBy('fireAt').limit(50).get()
  if (due.empty) return 0
  let sentCount = 0
  for (const doc of due.docs) {
    const entry = doc.data() as QueueEntry
    // Claim.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref)
      if (!fresh.exists || fresh.get('sent')) return false
      tx.update(doc.ref, { sent: true, sentAt: now })
      return true
    })
    if (!claimed) continue
    if (entry.fireAt < now - GRACE_MS) {
      logger.info('skipping stale alert', { id: doc.id })
      continue
    }
    const taskSnap = await db.collection('tasks').doc(entry.taskId).get()
    if (!taskSnap.exists) {
      await doc.ref.delete()
      continue
    }
    const task = normalizeTask(taskSnap.id, taskSnap.data() as Record<string, unknown>)
    const tz = task.timezone || 'UTC'
    const occ = expandTask(task, entry.occurrenceStart - 2 * DAY_MS, entry.occurrenceStart + 2 * DAY_MS).find((o) => o.dateKey === entry.dateKey)
    if (!occ || occ.completed) continue
    const userSnap = await db.collection('users').doc(task.owner).get()
    const user = userSnap.exists ? normalizeUser(userSnap.id, userSnap.data() as Record<string, unknown>) : null
    const ownerTz = user?.timezone || PEOPLE[task.owner].timezone || tz
    const early = entry.offsetMin > 0 ? ` · in ${entry.offsetMin >= 1440 ? `${Math.round(entry.offsetMin / 1440)} day(s)` : entry.offsetMin >= 60 ? `${Math.round(entry.offsetMin / 60)} hour(s)` : `${entry.offsetMin} min`}` : ''
    const body = `${formatDue(occ, ownerTz, now)}${early}`
    const ok = await sendToPerson(task.owner, {
      title: occ.title || 'Task',
      body,
      tag: `task-${task.id}-${occ.dateKey}`,
      url: `${APP_URL}/?task=${encodeURIComponent(task.id)}&date=${occ.dateKey}`,
      taskId: task.id,
      dateKey: occ.dateKey,
    })
    await db.collection('alertLog').doc(doc.id).set({ ...entry, sent: true, sentAt: now, delivered: ok })
    if (ok) sentCount++
  }
  return sentCount
}
