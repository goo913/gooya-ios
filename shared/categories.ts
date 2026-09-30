// Categories: GOOYA's own lists, which both people share. A task is in one, directly or through one of its owner's
// Apple Reminders lists (each stands for a category on that iPhone); a schedule may be in one. The category's colour is
// theirs: a task's ring, a schedule's fill (unless the schedule has its own colour). Dependency-free, shared by the app,
// the widget feed and Cloud Functions.

import type { Schedule, Task, TaskList } from './model'
import type { PersonKey } from './people'

/** GOOYA's first list, "Tasks": the category of a task nothing else says. */
export const DEFAULT_CATEGORY_ID = 'tasks'

const REMINDERS = 'apple-reminders'

/** A category: one of GOOYA's own lists (not someone's Reminders list). */
export const isCategory = (l: Pick<TaskList, 'source'> | undefined | null): boolean => !!l && l.source !== REMINDERS

export type ListIndex = Map<string, TaskList>

export const indexLists = (lists: TaskList[]): ListIndex => new Map(lists.map((l) => [l.id, l]))

/** Names are compared without case or surrounding spaces ("groceries" is "Groceries"). */
export const categoryKey = (name: string): string => name.trim().toLocaleLowerCase()

/** The categories in their order. */
export function categoriesOf(lists: TaskList[]): TaskList[] {
  return lists.filter(isCategory).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** The category a list is: itself for a GOOYA list, the category a Reminders list stands for, else null. */
export function categoryOfList(listId: string | null | undefined, byId: ListIndex): TaskList | null {
  const l = listId ? byId.get(listId) : undefined
  if (!l) return null
  if (isCategory(l)) return l
  const c = l.categoryId ? byId.get(l.categoryId) : undefined
  return c && isCategory(c) ? c : null
}

/** A task's colour: its category's; a Reminders list not linked to one has its own; null when neither is known. */
export function taskColor(t: Pick<Task, 'listId'>, byId: ListIndex): string | null {
  return categoryOfList(t.listId, byId)?.color ?? byId.get(t.listId)?.color ?? null
}

/** A schedule's colour: its own, else its category's, else null (it is then drawn in its owner's colour). */
export function scheduleColor(s: Pick<Schedule, 'color' | 'categoryId'>, byId: ListIndex): string | null {
  if (s.color) return s.color
  const c = s.categoryId ? byId.get(s.categoryId) : undefined
  return c && isCategory(c) ? c.color : null
}

/** A person's Reminders list that stands for a category (and takes new reminders), if they have one. */
export function remindersListFor(categoryId: string, owner: PersonKey, lists: TaskList[]): TaskList | null {
  return lists.find((l) => l.source === REMINDERS && l.owner === owner && l.categoryId === categoryId && !l.readOnly) ?? null
}

/**
 * The list a task of `owner` in a category goes in: the owner's Reminders list that stands for the category, or the
 * category itself (their iPhone, when it syncs Reminders, then makes that list and puts the reminder in it).
 */
export function listForCategory(categoryId: string, owner: PersonKey, lists: TaskList[]): string {
  return remindersListFor(categoryId, owner, lists)?.id ?? categoryId
}

/**
 * The list a new task of a person goes in: their default Reminders list when they sync Reminders (it becomes a reminder
 * there, as before categories), else Tasks.
 */
export function defaultListFor(owner: PersonKey, lists: TaskList[]): string {
  const rl = lists.find((l) => l.source === REMINDERS && l.owner === owner && l.isDefault && !l.readOnly)
  if (rl) return rl.id
  if (lists.some((l) => l.id === DEFAULT_CATEGORY_ID)) return DEFAULT_CATEGORY_ID
  return categoriesOf(lists)[0]?.id ?? DEFAULT_CATEGORY_ID
}

/** The category another category's name would clash with (a rename that would make two of the same name). */
export function sameNamed(name: string, lists: TaskList[], except?: string): TaskList | null {
  const key = categoryKey(name)
  return lists.find((l) => isCategory(l) && l.id !== except && categoryKey(l.name) === key) ?? null
}

/** Apple's colours for a list (Reminders' New List), as hex. */
export const CATEGORY_COLORS: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#ff3b30' },
  { name: 'Orange', hex: '#ff9500' },
  { name: 'Yellow', hex: '#ffcc00' },
  { name: 'Green', hex: '#34c759' },
  { name: 'Mint', hex: '#00c7be' },
  { name: 'Light Blue', hex: '#32ade6' },
  { name: 'Blue', hex: '#007aff' },
  { name: 'Indigo', hex: '#5856d6' },
  { name: 'Purple', hex: '#af52de' },
  { name: 'Pink', hex: '#ff2d55' },
  { name: 'Brown', hex: '#a2845e' },
  { name: 'Gray', hex: '#8e8e93' },
]
