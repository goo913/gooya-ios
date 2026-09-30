import { DEFAULT_CATEGORY_ID, categoryOfList, isCategory, listForCategory } from "@shared/categories";
import type { TaskList } from "@shared/model";
import type { PersonKey } from "@shared/people";
import { deleteList, newId, patchSchedule, patchTask, saveList } from "./db";
import { listIndexOf } from "./people";
import { syncRemindersSoon } from "./reminders";
import { useData } from "@/store/data";

/** Saves a category (a new one when `category` is undefined, at the end of the order); returns its id. */
export async function saveCategory(category: TaskList | undefined, fields: Pick<TaskList, "name" | "color" | "icon">, me: PersonKey): Promise<string> {
  const { lists } = useData.getState();
  const now = Date.now();
  const id = category?.id ?? newId();
  await saveList({
    ...category,
    ...fields,
    id,
    order: category?.order ?? Math.max(0, ...lists.filter(isCategory).map((l) => l.order)) + 1,
    createdBy: category?.createdBy ?? me,
    createdAt: category?.createdAt ?? now,
    updatedAt: now,
  });
  return id;
}

/** How many tasks and schedules are in a category (a task through its owner's Reminders list too). */
export function categoryUse(categoryId: string): { tasks: number; schedules: number } {
  const { tasks, schedules, lists } = useData.getState();
  const byId = listIndexOf(lists);
  return {
    tasks: tasks.filter((t) => categoryOfList(t.listId, byId)?.id === categoryId).length,
    schedules: schedules.filter((s) => s.categoryId === categoryId).length,
  };
}

/** The Reminders lists that stand for a category, whoever's they are. */
export function remindersListsOf(categoryId: string): TaskList[] {
  return useData.getState().lists.filter((l) => !isCategory(l) && l.categoryId === categoryId);
}

/**
 * Moves everything in category `from` into category `to`: tasks go to the list of `to` for their owner (their
 * Reminders list for it, when they have one), schedules follow, and Reminders lists that stood for `from` stand for `to`
 * (their iPhones then take its name and colour). `from` is deleted.
 */
export async function mergeCategory(from: string, to: string): Promise<void> {
  if (from === to) return;
  const { tasks, schedules, lists } = useData.getState();
  const byId = listIndexOf(lists);
  const relinked = lists.filter((l) => !isCategory(l) && l.categoryId === from).map((l) => ({ ...l, categoryId: to }));
  const after = lists.map((l) => relinked.find((r) => r.id === l.id) ?? l);
  for (const l of relinked) await saveList(l);
  for (const t of tasks) {
    // A task in a Reminders list that now stands for `to` stays in it.
    if (t.listId !== from || categoryOfList(t.listId, byId)?.id !== from) continue;
    await patchTask(t.id, { listId: listForCategory(to, t.owner, after) });
  }
  for (const s of schedules) if (s.categoryId === from) await patchSchedule(s.id, { categoryId: to });
  await deleteList(from);
  syncRemindersSoon(800);
}

/**
 * Deletes a category (never Tasks): its tasks move to Tasks, its schedules keep no category, and a Reminders list that
 * stood for it stands for none (it stays in Reminders, empty once its reminders have moved).
 */
export async function deleteCategory(id: string): Promise<void> {
  if (id === DEFAULT_CATEGORY_ID) return;
  const { tasks, schedules, lists } = useData.getState();
  const byId = listIndexOf(lists);
  const rest = lists.filter((l) => l.id !== id).map((l) => (!isCategory(l) && l.categoryId === id ? { ...l, categoryId: "" } : l));
  for (const l of lists) if (!isCategory(l) && l.categoryId === id) await saveList({ ...l, categoryId: "" });
  for (const t of tasks) {
    if (categoryOfList(t.listId, byId)?.id !== id) continue;
    await patchTask(t.id, { listId: listForCategory(DEFAULT_CATEGORY_ID, t.owner, rest) });
  }
  for (const s of schedules) if (s.categoryId === id) await patchSchedule(s.id, { categoryId: null });
  await deleteList(id);
  syncRemindersSoon(800);
}
