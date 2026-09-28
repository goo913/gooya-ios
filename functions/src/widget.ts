import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { expandTask } from '../../shared/recurrence'
import { normalizeSchedule, normalizeTask, normalizeUser } from '../../shared/normalize'
import { PEOPLE, PERSON_KEYS, colorPair, otherPerson, type PersonKey } from '../../shared/people'
import { DAY_MS, addDaysKey, keyInZone, startOfDayMs, todayKey } from '../../shared/time'
import { formatTime12 } from '../../shared/fmt'
import { todayScheduleOccurrences } from '../../shared/widgetFeed'

/**
 * GET /widgetFeed?token=…&days=14
 * JSON feed for the Scriptable widget, authorised by the per-person widget token.
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
  const days = Math.min(31, Math.max(1, Number(req.query.days ?? 14)))
  const tz = me.timezone || PEOPLE[me.key].timezone
  const today = todayKey(tz)
  const rangeStart = startOfDayMs(today, tz)
  const rangeEnd = rangeStart + days * DAY_MS
  const monthStart = `${today.slice(0, 7)}-01`
  const gridStart = startOfDayMs(monthStart, tz) - 7 * DAY_MS
  const gridEnd = startOfDayMs(addDaysKey(monthStart, 45), tz)

  const [tasksSnap, schedulesSnap] = await Promise.all([db.collection('tasks').get(), db.collection('schedules').get()])
  const tasks = tasksSnap.docs.map((d) => normalizeTask(d.id, d.data() as Record<string, unknown>))
  const schedules = schedulesSnap.docs.map((d) => normalizeSchedule(d.id, d.data() as Record<string, unknown>))

  const people = PERSON_KEYS.map((k) => {
    const u = users.find((x) => x.key === k)
    const color = colorPair(u?.color || PEOPLE[k].color, PEOPLE[k].color)
    return { key: k, name: u?.name || PEOPLE[k].name, timezone: u?.timezone || PEOPLE[k].timezone, colorLight: color.light, colorDark: color.dark }
  })

  const showCompleted = me.settings?.showCompleted !== false
  const items: Array<Record<string, unknown>> = []
  const dots: Record<string, PersonKey[]> = {}
  for (const t of tasks) {
    for (const occ of expandTask(t, Math.min(rangeStart, gridStart), Math.max(rangeEnd, gridEnd))) {
      if (!showCompleted && occ.completed) continue
      const day = occ.allDay ? occ.dueDate : keyInZone(occ.start, tz)
      if (!dots[day]) dots[day] = []
      if (!dots[day].includes(t.owner)) dots[day].push(t.owner)
      if (occ.end <= rangeStart || occ.start >= rangeEnd) continue
      items.push({
        id: occ.key,
        taskId: t.id,
        owner: t.owner,
        title: occ.title,
        allDay: occ.allDay,
        start: occ.start,
        end: occ.end,
        date: day,
        time: occ.allDay ? 'all-day' : `${formatTime12(occ.start, tz)}`,
        completed: occ.completed,
        flagged: !!t.flagged,
        priority: t.priority ?? 0,
        listId: t.listId,
      })
    }
  }
  items.sort((a, b) => (a.allDay === b.allDay ? (a.start as number) - (b.start as number) : a.allDay ? -1 : 1))

  const todaySchedules = todayScheduleOccurrences(schedules, rangeStart, Date.now())
    .map((o) => ({
      id: o.key,
      owner: o.schedule.owner,
      title: o.title,
      icon: o.icon,
      kind: o.schedule.kind,
      start: o.start,
      end: o.end,
      time: `${formatTime12(o.start, tz)} – ${formatTime12(o.end, tz)}`,
    }))

  res.set('Cache-Control', 'private, max-age=60')
  res.json({
    generatedAt: Date.now(),
    me: me.key,
    other: otherPerson(me.key),
    timezone: tz,
    today,
    people,
    items: items.slice(0, 60),
    schedules: todaySchedules,
    dots,
    appUrl: 'https://gooya-eunbee.web.app',
  })
})
