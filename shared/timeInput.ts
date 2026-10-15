// A time typed into a field ("12:45", "1245", "9", "9:30 pm", "21:15", "오후 3:30"), as GOOYA keeps it (HH:mm).

import type { HHmm } from './model'

/**
 * The time `text` means, or null when it is not one. Without AM or PM, an hour past 12 or written with a leading 0
 * ("09:30", "21:15") is on the 24-hour clock; 12 is noon; any other hour keeps `was`'s half of the day. Minutes may be
 * left out ("9" is 9:00), and the colon too ("945", "1245").
 */
export function parseTypedTime(text: string, was: HHmm): HHmm | null {
  let t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  let half: 'am' | 'pm' | null = null
  const before = /^(오전|오후)/.exec(t)
  if (before) {
    half = before[1] === '오전' ? 'am' : 'pm'
    t = t.slice(before[1].length)
  }
  const after = /(a\.?m\.?|p\.?m\.?|a|p|오전|오후)$/.exec(t)
  if (after) {
    half = /^(a|오전)/.test(after[1]) ? 'am' : 'pm'
    t = t.slice(0, -after[1].length)
  }
  let hour: number
  let minute = 0
  const sep = /^(\d{1,2})[:.h](\d{1,2})$/.exec(t)
  if (sep) {
    hour = Number(sep[1])
    minute = Number(sep[2])
  } else if (/^\d{1,2}$/.test(t)) hour = Number(t)
  else if (/^\d{3,4}$/.test(t)) {
    hour = Number(t.slice(0, t.length - 2))
    minute = Number(t.slice(-2))
  } else return null
  if (minute > 59 || hour > 23) return null
  const leadingZero = /^0\d/.test(t)
  if (half) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (half === 'pm' ? 12 : 0)
  } else if (hour >= 1 && hour <= 11 && !leadingZero) {
    if (Number(was.slice(0, 2)) >= 12) hour += 12
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
