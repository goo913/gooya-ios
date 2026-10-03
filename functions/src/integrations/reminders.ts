import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { normalizeList, normalizeTask } from '../../../shared/normalize'
import { PEOPLE } from '../../../shared/people'
import { LEGACY_REMINDERS_LIST_ID, applyReminderImport, type DeviceList, type LastEdit, type ReminderFields, type ReminderImport } from '../../../shared/reminders'
import { keyInZone, fieldsInZone } from '../../../shared/time'
import { personFromWidgetToken, shortHash } from './common'

export const REMINDERS_LIST_ID = LEGACY_REMINDERS_LIST_ID

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface IncomingReminder {
  id: string
  title: string
  notes?: string
  /** An instant (the Shortcut's "Due Date"); the app sends dueDate/dueTime instead. */
  due?: string | null
  /** The due day and time on the phone's clock (the iPhone app), time null for a date-only reminder. */
  dueDate?: string | null
  dueTime?: string | null
  completed?: boolean
  /** The Reminders list's name. */
  list?: string
  /** The Reminders list's id on the phone (newer apps). */
  listId?: string
  /** Apple's priority 0–9 (newer apps). */
  priority?: number
  url?: string
  /** The GOOYA task this reminder was just made from. */
  taskId?: string
  /** What the phone and GOOYA last agreed on for this reminder. */
  base?: ReminderFields
  /** It repeats in Reminders (newer apps): a done mark GOOYA has stays only while it is at the same time (mergeIntoTask). */
  recurring?: boolean
}

interface Body {
  token?: string
  full?: boolean
  timezone?: string
  reminders?: IncomingReminder[]
  /** The phone's Reminders lists (newer apps): each becomes a GOOYA list of this person. */
  lists?: DeviceList[]
  /** Tasks that left Reminders in GOOYA (moved to one of GOOYA's own lists): they stay, as GOOYA's own tasks. */
  unlink?: string[]
}

/** A reminder with its due day and time on the phone's clock (the Shortcut sent an instant). */
function normalized(r: IncomingReminder, tz: string): ReminderImport {
  let dueDate: string | null = null
  let dueTime: string | null = null
  if (r.dueDate !== undefined) {
    dueDate = typeof r.dueDate === 'string' ? r.dueDate : null
    dueTime = typeof r.dueTime === 'string' ? r.dueTime : null
  } else if (r.due) {
    const ms = Date.parse(r.due)
    if (!Number.isNaN(ms)) {
      dueDate = keyInZone(ms, tz)
      const f = fieldsInZone(ms, tz)
      // Reminders with a date only arrive at 00:00 local; treat midnight as date-only.
      dueTime = f.h === 0 && f.min === 0 ? null : `${String(f.h).padStart(2, '0')}:${String(f.min).padStart(2, '0')}`
    }
  }
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    notes: r.notes,
    url: r.url,
    dueDate,
    dueTime,
    completed: !!r.completed,
    list: r.list ?? '',
    listId: r.listId,
    priority: r.priority,
    taskId: r.taskId,
    base: r.base,
    recurring: r.recurring === true,
  }
}

/**
 * POST /remindersImport  { token, full?, timezone?, lists?, reminders: [...], unlink? }
 * Apple Reminders → GOOYA, sent by the iPhone app (src/lib/reminders.ts reads Reminders with EventKit and takes
 * GOOYA's changes to Reminders itself). Each Reminders list is a GOOYA list of that person, standing for one of the
 * categories both people share (made from the list when none has its name), each reminder a task in it
 * (shared/reminders.ts applyReminderImport decides what to write). When `full` is true, the person's reminder tasks
 * missing from the payload are removed (deleted in Reminders). `kept` in the answer counts fields GOOYA changed after
 * the phone read GOOYA; the phone takes them to Reminders on its next sync. Older apps send neither lists nor bases:
 * their reminders go to the single "Apple Reminders" list as before.
 */
export const remindersImport = onRequest({ cors: true, invoker: 'public', memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST JSON' })
    return
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as Body
  const person = await personFromWidgetToken(String(body.token ?? req.query.token ?? ''))
  if (!person) {
    res.status(403).json({ error: 'invalid token' })
    return
  }
  const db = getFirestore()
  const now = Date.now()
  const personTz = ((await db.collection('users').doc(person).get()).data()?.timezone as string) || PEOPLE[person].timezone
  const tz = typeof body.timezone === 'string' && isZone(body.timezone) ? body.timezone : personTz
  const incoming = (Array.isArray(body.reminders) ? body.reminders : []).filter((r) => r && r.id && r.title).map((r) => normalized(r, tz))
  const [listsSnap, mineSnap] = await Promise.all([db.collection('lists').get(), db.collection('tasks').where('owner', '==', person).get()])
  const lists = listsSnap.docs.map((d) => normalizeList(d.id, d.data() as Record<string, unknown>))
  const mine = mineSnap.docs.map((d) => normalizeTask(d.id, d.data() as Record<string, unknown>))
  const outcome = applyReminderImport(person, mine, lists, { lists: Array.isArray(body.lists) ? body.lists : undefined, reminders: incoming, unlink: body.unlink, full: !!body.full, timezone: tz }, now, shortHash)

  let batch = db.batch()
  let pending = 0
  const add = async (op: (b: FirebaseFirestore.WriteBatch) => void) => {
    op(batch)
    if (++pending >= 400) {
      await batch.commit()
      batch = db.batch()
      pending = 0
    }
  }
  if (!Array.isArray(body.lists) && !lists.some((l) => l.id === LEGACY_REMINDERS_LIST_ID)) {
    await add((b) => b.set(db.collection('lists').doc(LEGACY_REMINDERS_LIST_ID), { name: 'Apple Reminders', color: '#ff4245', icon: 'checkmark', order: 99, createdBy: person, createdAt: now, updatedAt: now }))
  }
  // Categories first (a list made from a Reminders list stands for one), then the Reminders lists.
  for (const c of outcome.categories) {
    const { id, ...rest } = c
    await add((b) => b.set(db.collection('lists').doc(id), rest))
  }
  for (const l of outcome.lists) {
    const { id, ...rest } = l
    await add((b) => b.set(db.collection('lists').doc(id), rest))
  }
  for (const id of outcome.deleteLists) await add((b) => b.delete(db.collection('lists').doc(id)))
  // Marked as the iPhone's own writes, so they do not wake that iPhone again (onTaskWritten).
  const fromReminders = { lastEdit: 'reminders' satisfies LastEdit }
  for (const t of outcome.tasks) {
    const ref = db.collection('tasks').doc(t.id)
    await add((b) => (t.create ? b.set(ref, { ...t.fields, ...fromReminders }) : b.set(ref, { ...t.fields, ...fromReminders }, { merge: true })))
  }
  for (const id of outcome.deleteTasks) await add((b) => b.delete(db.collection('tasks').doc(id)))
  if (pending) await batch.commit()
  // The old single "Apple Reminders" list goes once nothing is in it.
  if (Array.isArray(body.lists) && lists.some((l) => l.id === LEGACY_REMINDERS_LIST_ID)) {
    const left = await db.collection('tasks').where('listId', '==', LEGACY_REMINDERS_LIST_ID).limit(1).get()
    if (left.empty) await db.collection('lists').doc(LEGACY_REMINDERS_LIST_ID).delete()
  }
  await db.collection('users').doc(person).set({ remindersImportedAt: now, remindersImportedCount: incoming.length }, { merge: true })
  const { created, updated, removed, kept, unlinked } = outcome
  logger.info('remindersImport', { person, created, updated, removed, kept, unlinked, lists: outcome.lists.length, listsRemoved: outcome.deleteLists.length, categories: outcome.categories.length })
  res.json({ ok: true, created, updated, removed, kept, unlinked })
})
