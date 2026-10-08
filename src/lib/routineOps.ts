import type { DateKey, Routine, RoutineOccurrence, RoutineOverride } from "@shared/model";
import { expandRoutine } from "@shared/recurrence";
import { DAY_MS, addDaysKey, keyInZone, startOfDayMs } from "@shared/time";
import { deleteRoutine, patchRoutine } from "./db";

/**
 * A routine's day to show from `day`: that day when it is on, else its next day (Work on a Saturday: Monday), else its
 * last one before (a routine that has ended).
 */
export function routineOccurrenceNear(routine: Routine, day: DateKey): RoutineOccurrence | null {
  const at = startOfDayMs(day, routine.timezone);
  const next = expandRoutine(routine, at - DAY_MS, at + 400 * DAY_MS).find((o) => o.dateKey >= day);
  if (next) return next;
  const before = expandRoutine(routine, at - 400 * DAY_MS, at);
  return before[before.length - 1] ?? null;
}

/** A routine's next day from `now` (the one going on, when it is on now); one that has ended: its last day. */
export function routineOccurrenceAfter(routine: Routine, now: number): RoutineOccurrence | null {
  const next = expandRoutine(routine, now - 2 * DAY_MS, now + 400 * DAY_MS).find((o) => o.end > now);
  return next ?? routineOccurrenceNear(routine, keyInZone(now, routine.timezone));
}

/** "Delete This Day Only": add an EXDATE. */
export async function deleteRoutineDay(s: Routine, dateKey: DateKey): Promise<void> {
  const exdates = Array.from(new Set([...(s.exdates ?? []), dateKey]));
  const overrides = { ...(s.overrides ?? {}) };
  delete overrides[dateKey];
  await patchRoutine(s.id, { exdates, overrides });
}

/** "Edit This Day Only": store an override for that occurrence. */
export async function overrideRoutineDay(s: Routine, dateKey: DateKey, ov: RoutineOverride): Promise<void> {
  const overrides = { ...(s.overrides ?? {}), [dateKey]: ov };
  const exdates = (s.exdates ?? []).filter((d) => d !== dateKey);
  await patchRoutine(s.id, { overrides, exdates });
}

/** "Delete All Future": end the series the day before; delete it if nothing remains. */
export async function endRoutineBefore(s: Routine, dateKey: DateKey): Promise<void> {
  const last = addDaysKey(dateKey, -1);
  if (last < s.startDate) {
    await deleteRoutine(s.id);
    return;
  }
  const overrides = Object.fromEntries(Object.entries(s.overrides ?? {}).filter(([k]) => k <= last));
  const exdates = (s.exdates ?? []).filter((d) => d <= last);
  await patchRoutine(s.id, { endDate: last, overrides, exdates });
}
