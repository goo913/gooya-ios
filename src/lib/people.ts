import { indexLists, scheduleColor, taskColor, type ListIndex } from "@shared/categories";
import { DEFAULT_SETTINGS, type Schedule, type Task, type TaskList, type UserDoc, type UserSettings } from "@shared/model";
import { COLORS, PEOPLE, colorPair, otherPerson, type ColorName, type PersonKey } from "@shared/people";
import { useData } from "@/store/data";
import { usePrefs, type PersonFilter } from "@/store/prefs";
import { useSession } from "@/store/session";
import { useIsDark } from "@/theme";

export interface PersonInfo {
  key: PersonKey;
  name: string;
  timezone: string;
  /** Stored color: hex (or a legacy palette name). */
  color: string;
  hexLight: string;
  hexDark: string;
  settings: UserSettings;
  doc: UserDoc | undefined;
}

/** The hex of a stored colour (hex or palette name) for the current appearance. */
export function colorHex(c: string | null | undefined, dark: boolean, fallback: ColorName = "blue"): string {
  const pair = colorPair(c, fallback);
  return dark ? pair.dark : pair.light;
}

export function personInfo(key: PersonKey, doc: UserDoc | undefined): PersonInfo {
  const def = PEOPLE[key];
  const color = doc?.color || COLORS[def.color].dark;
  const pair = colorPair(color, def.color);
  return {
    key,
    name: doc?.name || def.name,
    timezone: doc?.timezone || def.timezone,
    color,
    hexLight: pair.light,
    hexDark: pair.dark,
    settings: { ...DEFAULT_SETTINGS, ...(doc?.settings ?? {}) },
    doc,
  };
}

export function usePerson(key: PersonKey): PersonInfo {
  const doc = useData((s) => s.users[key]);
  return personInfo(key, doc);
}

/** A person's colour for the current appearance. */
export function usePersonColor(key: PersonKey): string {
  const p = usePerson(key);
  return useIsDark() ? p.hexDark : p.hexLight;
}

const indexes = new WeakMap<TaskList[], ListIndex>();

/** The lists by id (kept per lists array, so every chip does not index them again). */
export function listIndexOf(lists: TaskList[]): ListIndex {
  let index = indexes.get(lists);
  if (!index) {
    index = indexLists(lists);
    indexes.set(lists, index);
  }
  return index;
}

/**
 * The colour a task is drawn in: its category's, whoever's it is and however many people are shown (a Reminders list
 * not in a category yet has its own colour); its owner's when neither is known.
 */
export function useTaskColor(task: Pick<Task, "owner" | "listId">): string {
  const personColor = usePersonColor(task.owner);
  const color = useData((s) => taskColor(task, listIndexOf(s.lists)));
  return color ?? personColor;
}

/** A schedule's colour: its own, its category's, or its owner's. */
export function scheduleHex(s: Pick<Schedule, "owner" | "color" | "categoryId">, users: Partial<Record<PersonKey, UserDoc>>, lists: TaskList[], dark: boolean): string {
  return scheduleColor(s, listIndexOf(lists)) ?? colorHex(users[s.owner]?.color || PEOPLE[s.owner].color, dark);
}

export function useMe(): PersonKey {
  return useSession((s) => s.me) ?? "gooya";
}

/** People included by the current filter, signed-in person first. */
export function useFilteredPeople(): PersonKey[] {
  const me = useMe();
  const filter = usePrefs((s) => s.filter);
  return peopleForFilter(me, filter);
}

export function peopleForFilter(me: PersonKey, filter: PersonFilter): PersonKey[] {
  if (filter === "me") return [me];
  if (filter === "other") return [otherPerson(me)];
  return [me, otherPerson(me)];
}
