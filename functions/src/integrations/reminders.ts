import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { normalizeTask } from '../../../shared/normalize'
import { PEOPLE } from '../../../shared/people'
import { keyInZone, fieldsInZone } from '../../../shared/time'
import { personFromWidgetToken, shortHash } from './common'

export const REMINDERS_LIST_ID = 'apple-reminders'

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
  list?: string
  priority?: number
  flagged?: boolean
  url?: string
}

/**
 * POST /remindersImport  { token, full?: boolean, timezone?: string, reminders: [...] }
 * Apple Reminders → GOOYA, sent by the iPhone app (src/lib/reminders.ts reads Reminders with EventKit; changes made in
 * GOOYA go back to Reminders from the phone). Reminders become tasks in the "Apple Reminders" list; when `full` is
 * true, tasks from this source that are missing from the payload are removed. `timezone` is the phone's, which the
 * reminders' dueDate/dueTime are on.
 */
export const remindersImport = onRequest({ cors: true, invoker: 'public', memory: '256MiB' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST JSON' })
    return
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { token?: string; full?: boolean; timezone?: string; reminders?: IncomingReminder[] }
  const person = await personFromWidgetToken(String(body.token ?? req.query.token ?? ''))
  if (!person) {
    res.status(403).json({ error: 'invalid token' })
    return
  }
  const incoming = Array.isArray(body.reminders) ? body.reminders : []
  const db = getFirestore()
  const personTz = ((await db.collection('users').doc(person).get()).data()?.timezone as string) || PEOPLE[person].timezone
  const phoneTz = typeof body.timezone === 'string' && isZone(body.timezone) ? body.timezone : null
  const tz = phoneTz ?? personTz
  const listRef = db.collection('lists').doc(REMINDERS_LIST_ID)
  if (!(await listRef.get()).exists) {
    await listRef.set({ name: 'Apple Reminders', color: '#ff4245', icon: 'checkmark', order: 99, createdBy: person, createdAt: Date.now(), updatedAt: Date.now() })
  }
  const existing = await db.collection('tasks').where('owner', '==', person).where('source', '==', 'apple-reminders').get()
  const byExternal = new Map<string, string>()
  for (const d of existing.docs) {
    const t = normalizeTask(d.id, d.data() as Record<string, unknown>)
    const ref = t.externalRefs.find((r) => r.source === 'apple-reminders')
    if (ref) byExternal.set(ref.externalId, d.id)
  }
  const seen = new Set<string>()
  let created = 0
  let updated = 0
  const batch = db.batch()
  const now = Date.now()
  for (const r of incoming) {
    if (!r || !r.id || !r.title) continue
    seen.add(r.id)
    let dueDate: string | null = null
    let dueTime: string | null = null
    if (r.dueDate !== undefined) {
      dueDate = typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? r.dueDate : null
      dueTime = dueDate && typeof r.dueTime === 'string' && /^\d{2}:\d{2}$/.test(r.dueTime) ? r.dueTime : null
    } else if (r.due) {
      const ms = Date.parse(r.due)
      if (!Number.isNaN(ms)) {
        dueDate = keyInZone(ms, tz)
        const f = fieldsInZone(ms, tz)
        // Reminders with a date only arrive at 00:00 or 09:00 local; treat midnight as date-only.
        dueTime = f.h === 0 && f.min === 0 ? null : `${String(f.h).padStart(2, '0')}:${String(f.min).padStart(2, '0')}`
      }
    }
    const fields = {
      owner: person,
      createdBy: person,
      listId: REMINDERS_LIST_ID,
      title: String(r.title).slice(0, 500),
      notes: [r.notes, r.url].filter(Boolean).join('\n'),
      dueDate,
      dueTime,
      timezone: tz,
      rrule: null,
      completed: !!r.completed,
      earlyReminders: [],
      tags: r.list ? [String(r.list).toLowerCase().replace(/\s+/g, '-')] : [],
      flagged: !!r.flagged,
      priority: r.priority === 1 || r.priority === 2 || r.priority === 3 ? r.priority : r.priority && r.priority >= 5 ? 3 : r.priority && r.priority >= 2 ? 2 : 0,
      source: 'apple-reminders',
      externalRefs: [{ source: 'apple-reminders', accountId: person, calendarId: r.list ?? '', externalId: r.id, updatedAt: now }],
      updatedAt: now,
    }
    const id = byExternal.get(r.id) ?? `ar_${shortHash(`${person}:${r.id}`, 20)}`
    if (byExternal.has(r.id)) {
      batch.set(db.collection('tasks').doc(id), fields, { merge: true })
      updated++
    } else {
      batch.set(db.collection('tasks').doc(id), { ...fields, exdates: [], overrides: {}, completedDates: [], createdAt: now })
      created++
    }
  }
  let removed = 0
  if (body.full) {
    for (const [ext, id] of byExternal) {
      if (!seen.has(ext)) {
        batch.delete(db.collection('tasks').doc(id))
        removed++
      }
    }
  }
  await batch.commit()
  await db.collection('users').doc(person).set({ remindersImportedAt: now, remindersImportedCount: incoming.length }, { merge: true })
  logger.info('remindersImport', { person, created, updated, removed })
  res.json({ ok: true, created, updated, removed })
})
