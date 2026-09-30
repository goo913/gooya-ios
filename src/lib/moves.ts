import type { CalendarEvent, DateKey, EventOccurrence, HHmm, TaskOccurrence } from "@shared/model";
import type { PersonKey } from "@shared/people";
import { isReminderList } from "@shared/reminders";
import { addDaysKey, keyInZone, zonedMs } from "@shared/time";
import { ActionSheetIOS } from "react-native";
import { useData } from "@/store/data";
import { patchEvent, patchSchedule } from "./db";
import { personInfo } from "./people";
import { applyTaskEdit, fieldsOf, type TaskFields } from "./taskOps";
import { viewerTz } from "./useNow";
import { clockOf, onClock } from "./zones";

// Moving things by dragging them (month, day and week views), as Apple Calendar does: a task keeps its time, a
// schedule its times and length; one that repeats asks whether this one only or all of them move.

/** Apple's action sheet of choices (Cancel added). */
export function chooseFrom(options: { label: string; destructive?: boolean; onSelect: () => void }[]): void {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0) },
    (i) => options[i]?.onSelect(),
  );
}

/** Whether something can be dragged: a task not in a list Reminders keeps read-only, a schedule or a two-way event. */
export function canMove(o: TaskOccurrence | EventOccurrence): boolean {
  if (o.kind === "event") return o.event.editable;
  const list = useData.getState().lists.find((l) => l.id === o.task.listId);
  return !(isReminderList(list) && list?.readOnly);
}

function saveTask(occ: TaskOccurrence, fields: TaskFields): void {
  const task = occ.task;
  if (!task.rrule) return void applyTaskEdit(task, occ, fields, "future");
  chooseFrom([
    { label: "Save for This Task Only", onSelect: () => void applyTaskEdit(task, occ, fields, "this") },
    { label: "Save for Future Tasks", onSelect: () => void applyTaskEdit(task, occ, fields, "future") },
  ]);
}

/** A task moved by whole days (the month): the same time on its own clock, that many days later or earlier. */
export function moveTaskByDays(occ: TaskOccurrence, days: number): void {
  if (!days) return;
  saveTask(occ, { ...fieldsOf(occ.task), title: occ.title, notes: occ.notes, dueDate: addDaysKey(occ.dueDate, days), dueTime: occ.dueTime });
}

/**
 * A task moved in a day view: to a day and a time on this phone's clock, and maybe to the other person's column. It is
 * kept on its owner's clock (the same moment).
 */
export function moveTaskTo(occ: TaskOccurrence, date: DateKey, time: HHmm, owner: PersonKey): void {
  const zone = personInfo(owner, useData.getState().users[owner]).timezone;
  const c = onClock(date, time, viewerTz, zone);
  saveTask(occ, { ...fieldsOf(occ.task), title: occ.title, notes: occ.notes, owner, dueDate: c.date, dueTime: c.time, timezone: zone });
}

function saveEvent(event: CalendarEvent, patch: Partial<CalendarEvent>): void {
  void (event.source === "gooya" ? patchSchedule(event.id, patch) : patchEvent(event.id, patch));
}

/** A schedule or event occurrence moved so it starts at `start` (all-day: on `startDate`), its length kept. */
function moveEvent(occ: EventOccurrence, next: { start: number; end: number; startDate: DateKey; endDate: DateKey }): void {
  const { event, dateKey } = occ;
  const delta = next.start - occ.start;
  const days = (s: number, e: number) => ({ startDate: keyInZone(s, event.timezone), endDate: keyInZone(Math.max(s, e - 1), event.timezone) });
  const shiftAll = () => {
    if (event.allDay) {
      const shift = Math.round((Date.UTC(...ymd(next.startDate)) - Date.UTC(...ymd(occ.startDate))) / 86_400_000);
      const startDate = addDaysKey(event.startDate, shift);
      const endDate = addDaysKey(event.endDate, shift);
      return saveEvent(event, { start: zonedMs(startDate, "00:00", event.timezone), end: zonedMs(addDaysKey(endDate, 1), "00:00", event.timezone), startDate, endDate });
    }
    saveEvent(event, { start: event.start + delta, end: event.end + delta, ...days(event.start + delta, event.end + delta) });
  };
  if (!event.rrule) return shiftAll();
  chooseFrom([
    { label: "Save for This Event Only", onSelect: () => saveEvent(event, { overrides: { ...(event.overrides ?? {}), [dateKey]: { ...(event.overrides?.[dateKey] ?? {}), start: next.start, end: next.end } } }) },
    { label: "Save for All Events", onSelect: shiftAll },
  ]);
}

const ymd = (key: DateKey): [number, number, number] => [Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))];

/** A schedule or event moved by whole days (the month): the same times, that many days later or earlier. */
export function moveEventByDays(occ: EventOccurrence, days: number): void {
  if (!days) return;
  const tz = occ.event.timezone;
  if (occ.allDay) {
    const startDate = addDaysKey(occ.startDate, days);
    const endDate = addDaysKey(occ.endDate, days);
    return moveEvent(occ, { start: zonedMs(startDate, "00:00", tz), end: zonedMs(addDaysKey(endDate, 1), "00:00", tz), startDate, endDate });
  }
  // The same wall-clock time here, a day later (not 24 hours: a daylight-saving change keeps the clock time).
  const at = clockOf(occ.start, viewerTz);
  const start = zonedMs(addDaysKey(at.date, days), at.time, viewerTz);
  const end = start + (occ.end - occ.start);
  moveEvent(occ, { start, end, startDate: keyInZone(start, tz), endDate: keyInZone(Math.max(start, end - 1), tz) });
}

/** A schedule or event moved in a day view to start at `start`, its length kept. */
export function moveEventTo(occ: EventOccurrence, start: number): void {
  const tz = occ.event.timezone;
  const end = start + (occ.end - occ.start);
  moveEvent(occ, { start, end, startDate: keyInZone(start, tz), endDate: keyInZone(Math.max(start, end - 1), tz) });
}
