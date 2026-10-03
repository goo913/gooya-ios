import type { DateKey, TaskOccurrence } from "@shared/model";
import { expandTask } from "@shared/recurrence";
import { addDaysKey, startOfDayMs } from "@shared/time";
import { useMemo } from "react";
import { useData } from "@/store/data";
import { viewerTz } from "./useNow";

export type SmartList = "today" | "scheduled" | "all" | "completed";
export const SMART: { key: SmartList; label: string; color: string; icon: string }[] = [
  { key: "today", label: "Today", color: "#0091ff", icon: "calendar" },
  { key: "scheduled", label: "Scheduled", color: "#ff4245", icon: "calendar" },
  { key: "all", label: "All", color: "#8e8e93", icon: "tray.fill" },
  { key: "completed", label: "Completed", color: "#8e8e93", icon: "checkmark.circle.fill" },
];

/** GOOYA's three kinds of item, each as a list of all of them (the Mac's sidebar, Library): list ids "kind:tasks" … */
export type LibraryKind = "tasks" | "schedules" | "routines";
export const LIBRARY: { key: LibraryKind; label: string; color: string; icon: string }[] = [
  { key: "tasks", label: "Tasks", color: "#0091ff", icon: "checklist" },
  { key: "schedules", label: "Schedules", color: "#ff4245", icon: "calendar" },
  { key: "routines", label: "Routines", color: "#af52de", icon: "repeat" },
];

/** All occurrences for the smart/user lists: undated tasks appear once (dateKey ''). */
export function useListOccurrences(people: string[], today: DateKey): TaskOccurrence[] {
  const tasks = useData((s) => s.tasks);
  return useMemo(() => {
    const from = startOfDayMs(addDaysKey(today, -365), viewerTz);
    const to = startOfDayMs(addDaysKey(today, 400), viewerTz);
    const out: TaskOccurrence[] = [];
    for (const t of tasks) {
      if (!people.includes(t.owner)) continue;
      if (!t.dueDate) {
        out.push({ kind: "task", task: t, key: `${t.id}:`, dateKey: "", isRecurring: false, dueDate: "", dueTime: null, allDay: true, start: 0, end: 0, title: t.title, notes: t.notes, completed: !!t.completed });
        continue;
      }
      if (!t.rrule) {
        out.push(...expandTask(t, 0, Number.MAX_SAFE_INTEGER));
        continue;
      }
      const all = expandTask(t, from, to);
      const next = all.find((o) => !o.completed && o.dueDate >= today) ?? all.find((o) => !o.completed);
      for (const o of all) if (o.completed || o === next) out.push(o);
    }
    return out;
  }, [tasks, people, today]);
}
