import { TZDate } from '@date-fns/tz'
import type { DateKey, HHmm } from './model'

export const DAY_MS = 86_400_000
export const MINUTE_MS = 60_000

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function makeKey(y: number, m1: number, d: number): DateKey {
  return `${y}-${pad2(m1)}-${pad2(d)}`
}

export function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  const d = Number(key.slice(8, 10))
  return { y, m, d }
}

export function parseHHmm(t: HHmm): { h: number; min: number } {
  const [h, min] = t.split(':').map(Number)
  return { h: h || 0, min: min || 0 }
}

export function formatHHmm(h: number, min: number): HHmm {
  return `${pad2(h)}:${pad2(min)}`
}

export function minutesOf(t: HHmm): number {
  const { h, min } = parseHHmm(t)
  return h * 60 + min
}

/** Date key of an instant in a zone. */
export function keyInZone(ms: number, tz: string): DateKey {
  const d = new TZDate(ms, tz)
  return makeKey(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Wall-clock fields of an instant in a zone. */
export function fieldsInZone(ms: number, tz: string) {
  const d = new TZDate(ms, tz)
  return {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    d: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes(),
    weekday: d.getDay(),
  }
}

/** Instant (ms) of a wall-clock date + time in a zone. */
export function zonedMs(key: DateKey, time: HHmm, tz: string): number {
  const { y, m, d } = parseKey(key)
  const { h, min } = parseHHmm(time)
  return new TZDate(y, m - 1, d, h, min, 0, 0, tz).getTime()
}

/** Midnight (start of day) of a date key in a zone. */
export function startOfDayMs(key: DateKey, tz: string): number {
  return zonedMs(key, '00:00', tz)
}

/** Minutes since local midnight of an instant in a zone (0..1440). */
export function minutesSinceMidnight(ms: number, tz: string): number {
  const f = fieldsInZone(ms, tz)
  return f.h * 60 + f.min
}

/** Floating (wall-clock-as-UTC) date from a key and optional time. Used with rrule. */
export function floatingFromKey(key: DateKey, time: HHmm = '00:00'): Date {
  const { y, m, d } = parseKey(key)
  const { h, min } = parseHHmm(time)
  return new Date(Date.UTC(y, m - 1, d, h, min, 0, 0))
}

export function keyFromFloating(d: Date): DateKey {
  return makeKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function timeFromFloating(d: Date): HHmm {
  return formatHHmm(d.getUTCHours(), d.getUTCMinutes())
}

/** Project an instant to floating time in a zone (for rrule range bounds). */
export function floatingInZone(ms: number, tz: string): Date {
  const f = fieldsInZone(ms, tz)
  return new Date(Date.UTC(f.y, f.m - 1, f.d, f.h, f.min, 0, 0))
}

/** Add whole days to a date key (calendar arithmetic, zone-independent). */
export function addDaysKey(key: DateKey, days: number): DateKey {
  const { y, m, d } = parseKey(key)
  const t = Date.UTC(y, m - 1, d + days)
  const n = new Date(t)
  return makeKey(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate())
}

/** Whole days from a to b (b - a). */
export function diffDaysKey(a: DateKey, b: DateKey): number {
  const pa = parseKey(a)
  const pb = parseKey(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS)
}

export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 0 = Sunday. */
export function weekdayOfKey(key: DateKey): number {
  const { y, m, d } = parseKey(key)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function todayKey(tz: string, now = Date.now()): DateKey {
  return keyInZone(now, tz)
}

/** Device time zone (falls back to UTC). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** UTC offset in minutes of a zone at an instant. */
export function offsetMinutes(ms: number, tz: string): number {
  const f = fieldsInZone(ms, tz)
  const asUtc = Date.UTC(f.y, f.m - 1, f.d, f.h, f.min, 0, 0)
  const truncated = Math.floor(ms / MINUTE_MS) * MINUTE_MS
  return Math.round((asUtc - truncated) / MINUTE_MS)
}
