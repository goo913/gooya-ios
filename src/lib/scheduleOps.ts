import type { DateKey, Schedule, ScheduleOverride } from "@shared/model";
import { addDaysKey } from "@shared/time";
import { deleteSchedule, patchSchedule } from "./db";

/** "Delete This Day Only": add an EXDATE. */
export async function deleteScheduleDay(s: Schedule, dateKey: DateKey): Promise<void> {
  const exdates = Array.from(new Set([...(s.exdates ?? []), dateKey]));
  const overrides = { ...(s.overrides ?? {}) };
  delete overrides[dateKey];
  await patchSchedule(s.id, { exdates, overrides });
}

/** "Edit This Day Only": store an override for that occurrence. */
export async function overrideScheduleDay(s: Schedule, dateKey: DateKey, ov: ScheduleOverride): Promise<void> {
  const overrides = { ...(s.overrides ?? {}), [dateKey]: ov };
  const exdates = (s.exdates ?? []).filter((d) => d !== dateKey);
  await patchSchedule(s.id, { overrides, exdates });
}

/** "Delete All Future": end the series the day before; delete it if nothing remains. */
export async function endScheduleBefore(s: Schedule, dateKey: DateKey): Promise<void> {
  const last = addDaysKey(dateKey, -1);
  if (last < s.startDate) {
    await deleteSchedule(s.id);
    return;
  }
  const overrides = Object.fromEntries(Object.entries(s.overrides ?? {}).filter(([k]) => k <= last));
  const exdates = (s.exdates ?? []).filter((d) => d <= last);
  await patchSchedule(s.id, { endDate: last, overrides, exdates });
}
