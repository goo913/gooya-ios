import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizeSchedule, normalizeTask, normalizeUser } from '../../shared/normalize'
import { buildWidgetFeed } from '../../shared/widgetFeed'

/**
 * GET /widgetFeed?token=…&days=14
 * JSON feed for the Home Screen widget (and the old Scriptable one), authorised by the per-person widget token.
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
  const days = Number(req.query.days ?? 14)
  const [tasksSnap, schedulesSnap] = await Promise.all([db.collection('tasks').get(), db.collection('schedules').get()])
  const tasks = tasksSnap.docs.map((d) => normalizeTask(d.id, d.data() as Record<string, unknown>))
  const schedules = schedulesSnap.docs.map((d) => normalizeSchedule(d.id, d.data() as Record<string, unknown>))

  res.set('Cache-Control', 'private, max-age=60')
  res.json(buildWidgetFeed({ me, users, tasks, schedules, days: Number.isFinite(days) ? days : 14 }))
})
