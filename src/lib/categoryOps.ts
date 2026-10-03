import { DEFAULT_CATEGORY_ID, categoriesInOrder, categoryOfList, isCategory, listForCategory } from "@shared/categories";
import type { TaskList } from "@shared/model";
import type { PersonKey } from "@shared/people";
import { useMemo } from "react";
import { Alert } from "react-native";
import { deleteList, deleteSchedule, newId, patchSchedule, patchSettings, patchTask, saveList } from "./db";
import { listIndexOf, useMe, usePerson } from "./people";
import { reminderIdOf } from "@shared/reminders";
import { syncRemindersSoon } from "./reminders";
import { deleteTaskScope } from "./taskOps";
import { useData } from "@/store/data";

/** The categories in this person's order (they drag them in the Mac's sidebar; each person orders them their own way). */
export function useCategories(): TaskList[] {
  const lists = useData((s) => s.lists);
  const order = usePerson(useMe()).settings.categoryOrder;
  return useMemo(() => categoriesInOrder(lists, order), [lists, order]);
}

/** Keeps this person's order of the categories (ids, first to last), on all their devices. */
export function setCategoryOrder(me: PersonKey, ids: string[]): Promise<void> {
  return patchSettings(me, { categoryOrder: ids });
}

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

/** A category's new colour (its menu's palette), for both people and the Reminders lists that are it. */
export async function recolorCategory(category: TaskList, color: string, me: PersonKey): Promise<void> {
  await saveCategory(category, { name: category.name, color, icon: category.icon }, me);
  if (remindersListsOf(category.id).length) syncRemindersSoon(800);
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
 * Deletes a category (never Tasks) and what is in it, whoever's: its tasks (a reminder among them goes from its owner's
 * Apple Reminders too: at once on their own device, else at their device's next sync) and its schedules. A Reminders list
 * that stood for it stands for none (it stays in Reminders, empty, to delete there if they like).
 */
export async function deleteCategory(id: string): Promise<void> {
  if (id === DEFAULT_CATEGORY_ID) return;
  const { tasks, schedules, lists } = useData.getState();
  const byId = listIndexOf(lists);
  for (const l of lists) if (!isCategory(l) && l.categoryId === id) await saveList({ ...l, categoryId: "" });
  for (const t of tasks) if (categoryOfList(t.listId, byId)?.id === id) await deleteTaskScope(t, null, "all");
  for (const s of schedules) if (s.categoryId === id) await deleteSchedule(s.id);
  await deleteList(id);
  syncRemindersSoon(800);
}

/**
 * Deleting a category from a menu or its sheet: an empty one goes at once; one with tasks or schedules in it asks first,
 * as they go with it. `onDeleted` runs once it has gone.
 */
export function confirmDeleteCategory(category: TaskList, onDeleted?: () => void): void {
  if (category.id === DEFAULT_CATEGORY_ID) return;
  const go = () => void deleteCategory(category.id).then(() => onDeleted?.());
  const use = categoryUse(category.id);
  if (!use.tasks && !use.schedules) return go();
  const { tasks, lists } = useData.getState();
  const byId = listIndexOf(lists);
  const reminders = tasks.some((t) => categoryOfList(t.listId, byId)?.id === category.id && reminderIdOf(t));
  const part = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
  const what = [use.tasks ? part(use.tasks, "task") : null, use.schedules ? part(use.schedules, "schedule") : null].filter(Boolean).join(" and ");
  Alert.alert(`Delete “${category.name}”?`, `The ${what} in it will be deleted too, for both of you.${reminders ? " Reminders among them go from Apple Reminders too." : ""}`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: go },
  ]);
}
