// Small formatting helpers shared with Cloud Functions (notification text, widget feed).
import type { TaskOccurrence } from './model'
import { fieldsInZone, keyInZone, parseKey, todayKey } from './time'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatTime12(ms: number, tz: string): string {
  const f = fieldsInZone(ms, tz)
  const suffix = f.h < 12 ? 'AM' : 'PM'
  const hour = f.h % 12 === 0 ? 12 : f.h % 12
  return `${hour}:${f.min < 10 ? '0' : ''}${f.min} ${suffix}`
}

/** "Mon, Sep 28" */
export function formatShortDate(key: string): string {
  const { y, m, d } = parseKey(key)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAY_SHORT[wd]}, ${MONTH_SHORT[m - 1]} ${d}`
}

/**
 * When a task is due, on a reader's clock (`tz`): "Today · 8:40 PM", "Thu, Oct 8 · 9:40 AM", or "Today" for a date-only
 * one. The day is theirs as well as the time: 9:40 AM Thursday in Seoul is 8:40 PM Wednesday in New York.
 */
export function formatDue(due: Pick<TaskOccurrence, 'allDay' | 'dueDate' | 'start'>, tz: string, now: number): string {
  const day = due.allDay ? due.dueDate : keyInZone(due.start, tz)
  const label = day === todayKey(tz, now) ? 'Today' : formatShortDate(day)
  return due.allDay ? label : `${label} · ${formatTime12(due.start, tz)}`
}
