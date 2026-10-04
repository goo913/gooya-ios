import { countLists, listSchedules, listTasks, type ListCounts } from "@shared/lists";
import type { DateKey, TaskOccurrence } from "@shared/model";
import { useMemo } from "react";
import { useData } from "@/store/data";
import { listIndexOf } from "./people";
import { useNow, viewerTz } from "./useNow";

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
  return useMemo(() => listTasks(tasks, people, today, viewerTz), [tasks, people, today]);
}

/**
 * What each list counts (the iPhone's Lists, the Mac's sidebar), as its page lists them: tasks not done and schedules
 * not over, so a category counts both.
 */
export function useListCounts(people: string[], today: DateKey): ListCounts {
  const occ = useListOccurrences(people, today);
  const schedules = useData((s) => s.schedules);
  const routines = useData((s) => s.routines);
  const lists = useData((s) => s.lists);
  // A schedule stops counting once it has ended (this, kept fresh by the minute).
  const now = useNow(60_000);
  return useMemo(() => countLists(occ, listSchedules(schedules, people, today, now, viewerTz), routines, people, today, listIndexOf(lists)), [occ, schedules, routines, lists, people, today, now]);
}
