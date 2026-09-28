// Small formatting helpers shared with Cloud Functions (notification text, widget feed).
import { fieldsInZone, parseKey } from './time'

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
