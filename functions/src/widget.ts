import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizeEvent, normalizeList, normalizeSchedule, normalizeTask, normalizeUser } from '../../shared/normalize'
import type { Schedule } from '../../shared/model'
import { buildWidgetFeed } from '../../shared/widgetFeed'

/**
 * GET /widgetFeed?token=…&days=31
 * JSON feed for the Home Screen widget, authorised by the per-person widget token: tasks, schedules and the events of
 * connected calendars (never routines).
 * The phone app builds the same feed itself (shared/widgetFeed.ts); the widget asks here when the app has not
 * run for a while.
 */
export const widgetFeed = onRequest({ cors: true, invoker: 'public' }, async (req, res) => {
  const token = String(req.query.token ?? req.headers['x-widget-token'] ?? '')
  if (!token || token.length < 24) {
    res.status(401).json({ error: 'missing token' })
    return
  }
  const db = getFirestore()
  const usersSnap = await db.collection('users').get()
  const users = usersSnap.docs.map((d) => normalizeUser(d.id, d.data() as Record<string, unknown>)).filter((u): u is NonNullable<typeof u> => !!u)
  const me = users.find((u) => u.widgetToken && u.widgetToken === token)
  if (!me) {
    res.status(403).json({ error: 'invalid token' })
    return
  }
  const days = Number(req.query.days ?? 31)
  const [tasksSnap, schedulesSnap, eventsSnap, listsSnap] = await Promise.all(['tasks', 'schedules', 'events', 'lists'].map((c) => db.collection(c).get()))
  const data = (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as Record<string, unknown>
  const tasks = tasksSnap.docs.map((d) => normalizeTask(d.id, data(d)))
  const schedules = schedulesSnap.docs.map((d) => normalizeSchedule(d.id, data(d))).filter((s): s is Schedule => !!s)
  const events = eventsSnap.docs.map((d) => normalizeEvent(d.id, data(d)))
  const lists = listsSnap.docs.map((d) => normalizeList(d.id, data(d)))

  res.set('Cache-Control', 'private, max-age=60')
  res.json(buildWidgetFeed({ me, users, tasks, schedules, events, lists, days: Number.isFinite(days) ? days : 31 }))
})
