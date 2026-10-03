import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/**
 * Apple Reminders on this iPhone, through EventKit (ios/GooyaRemindersModule.swift). Days and times are the phone's
 * clock as GOOYA keeps them: "2026-09-29" and "17:00".
 */

export interface NativeReminderList {
  id: string;
  title: string;
  /** #rrggbb */
  color: string;
  /** Reminders lets apps change what is in it (not a subscribed or view-only shared list). */
  writable: boolean;
  /** Reminders lets apps rename and recolour it (not a list someone else shared). Missing from builds before categories. */
  editable?: boolean;
  isDefault: boolean;
  /** The account it is in ("iCloud", "On My iPhone", …). */
  source: string;
}

export interface NativeReminder {
  id: string;
  listId: string;
  list: string;
  title: string;
  notes: string;
  url: string;
  dueDate: string | null;
  dueTime: string | null;
  completed: boolean;
  /** 0 none, 1–4 high, 5 medium, 6–9 low. */
  priority: number;
  /** It repeats. Saved as done, it comes back at its next time, not done; a done copy of that time is a new reminder. */
  recurring: boolean;
  alarms: ({ at: number } | { offset: number })[];
  lastModified: number;
}

export interface ReminderSave {
  /** Leave out to make a new reminder in `listId`. */
  id?: string;
  /** The list to make it in, or to move it to. */
  listId?: string;
  title?: string;
  notes?: string;
  /** Change the due day/time (dueDate null clears it). */
  setDue?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  /** Alert at the due time, as the Reminders app sets for a reminder with a time. */
  alarmAtDue?: boolean;
  completed?: boolean;
  priority?: number;
}

export interface ListSave {
  /** Leave out to make a new list. */
  id?: string;
  title?: string;
  /** #rrggbb */
  color?: string;
}

interface GooyaRemindersModule {
  authorization(): "granted" | "denied" | "restricted" | "undetermined";
  requestAccess(): Promise<boolean>;
  lists(): Promise<NativeReminderList[]>;
  reminders(listIds: string[], completedSince: number): Promise<NativeReminder[]>;
  /** The reminder as Reminders keeps it after the save (read back from the store). */
  save(input: ReminderSave): Promise<NativeReminder>;
  remove(id: string): Promise<boolean>;
  /** Missing from builds before categories. */
  saveList?: (input: ListSave) => Promise<NativeReminderList>;
  isMac(): boolean;
  addListener(event: "onChange", listener: () => void): EventSubscription;
}

/** null in Expo Go or a build made before this module existed. */
const native = requireOptionalNativeModule<GooyaRemindersModule>("GooyaReminders");

export const isAvailable = native != null;

function need(): GooyaRemindersModule {
  if (!native) throw new Error("This GOOYA build can't reach Reminders. Install the latest build (npm run iphone).");
  return native;
}

export const authorization = () => (native ? native.authorization() : "undetermined");
export const requestAccess = () => need().requestAccess();
export const lists = () => need().lists();
export const reminders = (listIds: string[], completedSince: number) => need().reminders(listIds, completedSince);
export const save = (input: ReminderSave) => need().save(input);
export const remove = (id: string) => need().remove(id);
/** This build can make, rename and recolour Reminders lists (GOOYA's categories). */
export const canSaveLists = typeof native?.saveList === "function";
export const saveList = (input: ListSave) => {
  const m = need();
  if (!m.saveList) throw new Error("This GOOYA build can't make Reminders lists. Install the latest build (npm run iphone).");
  return m.saveList(input);
};
/** GOOYA running on a Mac (the iPhone app on an Apple silicon Mac). */
export const isMac = () => (native?.isMac ? native.isMac() : false);

/** Called when anything changes in Reminders (including GOOYA's own saves). */
export function onChange(listener: () => void): EventSubscription | null {
  return native ? native.addListener("onChange", listener) : null;
}
