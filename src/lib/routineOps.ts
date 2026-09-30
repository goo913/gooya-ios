import type { DateKey, Routine, RoutineOverride } from "@shared/model";
import { addDaysKey } from "@shared/time";
import { deleteRoutine, patchRoutine } from "./db";

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
