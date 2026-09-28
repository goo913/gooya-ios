import type { DateKey } from "@shared/model";
import { describeRule } from "@shared/recurrence";
import { fieldsInZone, parseKey } from "@shared/time";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "9:30 AM" like Apple. */
export function formatTime(ms: number, tz: string): string {
  const f = fieldsInZone(ms, tz);
  return formatHM(f.h, f.min);
}

export function formatHM(h: number, min: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${min < 10 ? "0" : ""}${min} ${suffix}`;
}

/** Hour gutter label parts: { num: '3', suffix: 'PM' } */
export function hourLabel(h: number): { num: string; suffix: string } {
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { num: String(hour), suffix: h < 12 || h === 24 ? "AM" : "PM" };
}

/** "Sun – Sep 27" */
export function formatColumnHeader(key: DateKey): string {
  const { y, m, d } = parseKey(key);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY_SHORT[wd]} – ${MONTH_SHORT[m - 1]} ${d}`;
}

/** "Sunday, September 27, 2026" */
export function formatLongDate(key: DateKey): string {
  const { y, m, d } = parseKey(key);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY_LONG[wd]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** "Sep 27, 2026" */
export function formatMediumDate(key: DateKey, withYear = true): string {
  const { y, m, d } = parseKey(key);
  return `${MONTH_SHORT[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

const TZ_ABBR: Record<string, string> = { "Asia/Seoul": "KST", "Asia/Tokyo": "JST" };

/** Short zone label like "KST" or "EDT". */
export function tzAbbrev(tz: string, ms = Date.now()): string {
  if (TZ_ABBR[tz]) return TZ_ABBR[tz];
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

export function describeRuleSafe(body: string | null): string {
  try {
    return describeRule(body);
  } catch {
    return "Custom";
  }
}
