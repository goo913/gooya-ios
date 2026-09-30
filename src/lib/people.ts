import { DEFAULT_SETTINGS, type Task, type UserDoc, type UserSettings } from "@shared/model";
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

/**
 * The colour a task is drawn in. With both people shown it is its owner's colour (whose it is); with one person shown,
 * its list's colour, so lists tell tasks apart (a Reminders list keeps its colour from Reminders). `shown` is how many
 * people the view shows when it chooses that itself (the day view has its own setting), else the filter's.
 */
export function useTaskColor(task: Pick<Task, "owner" | "listId">, shown?: number): string {
  const personColor = usePersonColor(task.owner);
  const filtered = useFilteredPeople().length;
  const single = (shown ?? filtered) === 1;
  const listColor = useData((s) => (single ? s.lists.find((l) => l.id === task.listId)?.color : undefined));
  return single && listColor ? listColor : personColor;
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
