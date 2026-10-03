import { categoriesInOrder, categoryOfList, listForCategory } from "@shared/categories";
import type { EventOccurrence, RoutineOccurrence, TaskList, TaskOccurrence } from "@shared/model";
import { reminderIdOf } from "@shared/reminders";
import { deleteRoutine, deleteSchedule, patchEvent, patchSchedule, patchTask } from "@/lib/db";
import { listIndexOf } from "@/lib/people";
import { syncRemindersSoon } from "@/lib/reminders";
import { deleteRoutineDay, endRoutineBefore } from "@/lib/routineOps";
import { deleteTaskScope, toggleCompleted } from "@/lib/taskOps";
import { useData } from "@/store/data";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import type { MacMenuItem } from "./MacMenu";

type Item = TaskOccurrence | EventOccurrence | RoutineOccurrence;

/** GOOYA may change and delete an event: one of its own schedules, or an event of a two-way calendar. */
const changeable = (o: EventOccurrence): boolean => o.event.source === "gooya" || !!o.event.editable;

/** A schedule's own record (GOOYA's), for its category. */
const scheduleOf = (o: EventOccurrence) => (o.event.source === "gooya" ? useData.getState().schedules.find((x) => x.id === o.event.id) : undefined);

/** The categories as a submenu, the item's own ticked: picking one moves it there. */
function categoryMenu(current: string | null, categories: TaskList[], allowNone: boolean): MacMenuItem {
  return {
    title: "Category",
    symbol: "folder",
    children: [
      ...(allowNone ? [{ id: "category:", title: "None", checked: current === null }] : []),
      ...categories.map((c) => ({ id: `category:${c.id}`, title: c.name, checked: c.id === current })),
    ],
  };
}

/**
 * Right-click on something in the calendar (Apple Calendar's menu for an event or a reminder): Get Info; for a task,
 * Mark as Completed (or Incomplete); its category; and Delete (for one that repeats: this one, all future ones or all).
 */
export function itemMenuItems(o: Item): MacMenuItem[] {
  // This person's order of the categories (read when the menu is made: a change reaches it at the next render).
  const { lists, users } = useData.getState();
  const me = useSession.getState().me;
  const categories = categoriesInOrder(lists, me ? users[me]?.settings?.categoryOrder : undefined);
  const info: MacMenuItem = { id: "open", title: "Get Info", symbol: "info.circle" };
  if (o.kind === "task") {
    const byId = listIndexOf(useData.getState().lists);
    const remove: MacMenuItem = o.task.rrule
      ? {
          title: "Delete",
          symbol: "trash",
          children: [
            { id: "delete.this", title: "This Task Only", destructive: true },
            { id: "delete.future", title: "All Future Tasks", destructive: true },
            { id: "delete.all", title: "All Tasks", destructive: true },
          ],
        }
      : { id: "delete.all", title: reminderIdOf(o.task) ? "Delete Reminder" : "Delete Task", symbol: "trash", destructive: true };
    return [
      info,
      { id: "toggle", title: o.completed ? "Mark as Incomplete" : "Mark as Completed", symbol: o.completed ? "circle" : "checkmark.circle" },
      { inline: true, children: [categoryMenu(categoryOfList(o.task.listId, byId)?.id ?? null, categories, false)] },
      { inline: true, children: [remove] },
    ];
  }
  if (o.kind === "event") {
    if (!changeable(o)) return [info];
    const own = scheduleOf(o);
    const remove: MacMenuItem = o.event.rrule
      ? {
          title: "Delete",
          symbol: "trash",
          children: [
            { id: "delete.this", title: "This Schedule Only", destructive: true },
            { id: "delete.all", title: "All Schedules", destructive: true },
          ],
        }
      : { id: "delete.all", title: own ? "Delete Schedule" : "Delete Event", symbol: "trash", destructive: true };
    return [info, ...(own ? [{ inline: true, children: [categoryMenu(own.categoryId ?? null, categories, true)] }] : []), { inline: true, children: [remove] }];
  }
  return [
    info,
    {
      inline: true,
      children: [
        {
          title: "Delete",
          symbol: "trash",
          children: [
            { id: "delete.this", title: "This Day Only", destructive: true },
            { id: "delete.future", title: "All Future Days", destructive: true },
            { id: "delete.all", title: "Routine", destructive: true },
          ],
        },
      ],
    },
  ];
}

/** Does what was chosen from `itemMenuItems` (`open` opens it as a double-click does). */
export function runItemMenu(o: Item, id: string, open: () => void): void {
  if (id === "open") return open();
  if (o.kind === "task") {
    if (id === "toggle") void toggleCompleted(o);
    else if (id.startsWith("category:")) {
      // Into the category's list for its owner (their Reminders list for it, when they have one).
      void patchTask(o.task.id, { listId: listForCategory(id.slice(9), o.task.owner, useData.getState().lists) }).then(() => syncRemindersSoon(800));
    } else if (id === "delete.this" || id === "delete.future" || id === "delete.all") void deleteTaskScope(o.task, o, id === "delete.this" ? "this" : id === "delete.future" ? "future" : "all");
    return;
  }
  if (o.kind === "event") {
    const ev = o.event;
    const own = ev.source === "gooya";
    if (id.startsWith("category:") && own) void patchSchedule(ev.id, { categoryId: id.slice(9) || null });
    else if (id === "delete.all") void (own ? deleteSchedule(ev.id) : patchEvent(ev.id, { deleted: true }));
    else if (id === "delete.this") {
      const overrides = { ...(ev.overrides ?? {}) };
      delete overrides[o.dateKey];
      const patch = { exdates: [...new Set([...(ev.exdates ?? []), o.dateKey])], overrides };
      void (own ? patchSchedule(ev.id, patch) : patchEvent(ev.id, patch));
    }
    return;
  }
  if (id === "delete.this") void deleteRoutineDay(o.routine, o.dateKey);
  else if (id === "delete.future") void endRoutineBefore(o.routine, o.dateKey);
  else if (id === "delete.all") void deleteRoutine(o.routine.id);
}

/** Right-click on an empty day or time: Calendar's New Event and New Reminder, here a schedule or a task. */
export const NEW_MENU: MacMenuItem[] = [
  { id: "new.schedule", title: "New Schedule", symbol: "calendar.badge.plus" },
  { id: "new.task", title: "New Task", symbol: "checklist" },
];

/** Picks the kind for the popover a new item opens in (it remembers it, as its switch does). */
export function newKindFrom(id: string): boolean {
  if (id !== "new.schedule" && id !== "new.task") return false;
  usePrefs.getState().setNewKind(id === "new.task" ? "task" : "schedule");
  return true;
}
