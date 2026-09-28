import type { DateKey, HHmm } from "@shared/model";
import { formatHHmm, makeKey, parseHHmm, parseKey } from "@shared/time";

/** A calendar date as a local Date at noon (safe from DST edges), for the native pickers. */
export function dateFromKey(key: DateKey): Date {
  const { y, m, d } = parseKey(key);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function keyFromDate(date: Date): DateKey {
  return makeKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function dateFromHHmm(t: HHmm): Date {
  const { h, min } = parseHHmm(t);
  return new Date(2000, 0, 1, h, min, 0, 0);
}

export function hhmmFromDate(date: Date): HHmm {
  return formatHHmm(date.getHours(), date.getMinutes());
}
