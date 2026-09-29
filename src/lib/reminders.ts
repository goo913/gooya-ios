import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Task, TaskList } from "@shared/model";
import { PEOPLE } from "@shared/people";
import {
  REMINDERS_LIST_ID,
  REMINDERS_SOURCE,
  baselineOf,
  planReminderSync,
  reminderFields,
  reminderIdOf,
  toImport,
  type DeviceReminder,
  type ReminderFields,
} from "@shared/reminders";
import { deviceTimeZone, fieldsInZone, keyInZone, zonedMs } from "@shared/time";
import * as Calendar from "expo-calendar";
import { AppState } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useData } from "@/store/data";
import { useSession } from "@/store/session";
import { newId, patchUser } from "./db";
import { env } from "./env";
import { isMock } from "./mock";

/**
 * Apple Reminders ⇄ GOOYA from the iPhone itself (no Shortcut): the app reads the reminders on this phone with
 * EventKit, sends them to the server's remindersImport (they become tasks in the "Apple Reminders" list, for both
 * people), and writes back what was changed in GOOYA since the last sync (completed, renamed, re-dated, notes).
 * shared/reminders.ts decides which side wins.
 *
 * It runs when the app opens or comes back to the front (at most every 10 seconds), a moment after a reminder is changed
 * in GOOYA, and on Sync Now. Only the phone whose owner turned it on does this.
 */

export interface ReminderListInfo {
  id: string;
  title: string;
  color: string;
}

interface RemindersState {
  /** Turned on in Settings → Calendar integrations on this phone. */
  enabled: boolean;
  /** Reminders lists left out (EventKit calendar ids). */
  excluded: string[];
  /** What GOOYA and this phone last agreed on, per reminder id. */
  baseline: Record<string, ReminderFields>;
  lastSync: number | null;
  lastCount: number;
  lastError: string | null;
  /** "denied" once the person said no to Reminders access (Settings → GOOYA turns it on again). */
  access: "granted" | "denied" | "undetermined";
  syncing: boolean;
  lists: ReminderListInfo[];
}

export const useReminders = create<RemindersState>()(
  persist(
    (): RemindersState => ({
      enabled: false,
      excluded: [],
      baseline: {},
      lastSync: null,
      lastCount: 0,
      lastError: null,
      access: "undetermined",
      syncing: false,
      lists: [],
    }),
    {
      name: "gooya-reminders",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabled: s.enabled, excluded: s.excluded, baseline: s.baseline, lastSync: s.lastSync, lastCount: s.lastCount, lastError: s.lastError, access: s.access, lists: s.lists }),
    },
  ),
);

const COMPLETED_DAYS = 30;
const MIN_GAP_MS = 10_000;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function readReminder(r: Calendar.ExpoCalendarReminder, lists: Map<string, string>, tz: string): DeviceReminder | null {
  if (!r.id) return null;
  let dueDate: DeviceReminder["dueDate"] = null;
  let dueTime: DeviceReminder["dueTime"] = null;
  const due = r.dueDate ? new Date(r.dueDate).getTime() : NaN;
  if (!Number.isNaN(due)) {
    dueDate = keyInZone(due, tz);
    const f = fieldsInZone(due, tz);
    // EventKit gives a date-only reminder at midnight.
    dueTime = r.allDay || (f.h === 0 && f.min === 0) ? null : `${String(f.h).padStart(2, "0")}:${String(f.min).padStart(2, "0")}`;
  }
  return {
    id: r.id,
    title: asString(r.title).trim() || "(No title)",
    notes: asString(r.notes),
    url: asString(r.url),
    location: asString(r.location),
    dueDate,
    dueTime,
    completed: !!r.completed,
    list: lists.get(r.calendarId ?? "") ?? "Reminders",
  };
}

/** Asks for Reminders access (the system prompt, once). */
export async function requestRemindersAccess(): Promise<boolean> {
  const { status } = await Calendar.requestRemindersPermissions();
  useReminders.setState({ access: status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined" });
  return status === "granted";
}

async function hasAccess(): Promise<boolean> {
  const { status } = await Calendar.getRemindersPermissions();
  useReminders.setState({ access: status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined" });
  return status === "granted";
}

async function reminderCalendars(): Promise<Calendar.ExpoCalendar[]> {
  return Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
}

/** The Reminders lists on this phone (for choosing which ones GOOYA shows). */
export async function loadReminderLists(): Promise<ReminderListInfo[]> {
  const calendars = await reminderCalendars();
  const lists = calendars.map((c) => ({ id: c.id, title: c.title ?? "Reminders", color: c.color ?? "#ff9500" })).sort((a, b) => a.title.localeCompare(b.title));
  useReminders.setState({ lists });
  return lists;
}

/** The phone's reminders (open ones, and those completed in the last 30 days), with the objects to save changes on. */
async function readDeviceReminders(): Promise<{ reminders: DeviceReminder[]; objects: Map<string, Calendar.ExpoCalendarReminder> }> {
  const tz = deviceTimeZone();
  const calendars = await reminderCalendars();
  const lists = calendars.map((c) => ({ id: c.id, title: c.title ?? "Reminders", color: c.color ?? "#ff9500" })).sort((a, b) => a.title.localeCompare(b.title));
  useReminders.setState({ lists });
  const { excluded } = useReminders.getState();
  const names = new Map(lists.map((l) => [l.id, l.title]));
  const now = new Date();
  const since = new Date(now.getTime() - COMPLETED_DAYS * 86_400_000);
  const reminders: DeviceReminder[] = [];
  const objects = new Map<string, Calendar.ExpoCalendarReminder>();
  for (const cal of calendars) {
    if (excluded.includes(cal.id)) continue;
    const [open, done] = await Promise.all([cal.listReminders(null, null, Calendar.ReminderStatus.INCOMPLETE), cal.listReminders(since, now, Calendar.ReminderStatus.COMPLETED)]);
    for (const r of [...open, ...done]) {
      const d = readReminder(r, names, tz);
      if (!d || objects.has(d.id)) continue;
      objects.set(d.id, r);
      reminders.push(d);
    }
  }
  return { reminders, objects };
}

/** Saves GOOYA's changes to the reminders on this phone. */
async function writeBack(changes: ReturnType<typeof planReminderSync>["changes"], objects: Map<string, Calendar.ExpoCalendarReminder>): Promise<void> {
  const tz = deviceTimeZone();
  for (const c of changes) {
    const reminder = objects.get(c.id);
    if (!reminder) continue;
    const details: Partial<Calendar.ModifiableReminderProperties> & { allDay?: boolean } = {};
    if (c.title !== undefined) details.title = c.title;
    if (c.completed !== undefined) {
      details.completed = c.completed;
      if (c.completed) details.completionDate = new Date().toISOString();
    }
    if (c.notes !== undefined) details.notes = c.notes;
    if (c.dueDate) {
      details.dueDate = new Date(zonedMs(c.dueDate, c.dueTime ?? "00:00", tz)).toISOString();
      details.allDay = !c.dueTime;
    }
    try {
      await reminder.update(details);
    } catch {
      // The reminder was deleted on the phone meanwhile: the import below leaves it out.
    }
  }
}

async function ensureToken(): Promise<string | null> {
  const me = useSession.getState().me;
  if (!me) return null;
  const token = useData.getState().users[me]?.widgetToken;
  if (token) return token;
  const next = `${newId()}${newId()}`;
  await patchUser(me, { widgetToken: next });
  return next;
}

/** Demo mode has no server: the reminders become tasks right here, by the server's rules. */
function importLocally(reminders: DeviceReminder[]): void {
  const me = useSession.getState().me ?? "gooya";
  const now = Date.now();
  useData.setState((s) => {
    const mine = new Map<string, Task>();
    for (const t of s.tasks) {
      const id = t.owner === me ? reminderIdOf(t) : null;
      if (id) mine.set(id, t);
    }
    const others = s.tasks.filter((t) => !(t.owner === me && reminderIdOf(t)));
    const imported = reminders.map((r): Task => {
      const f = reminderFields(r);
      const prev = mine.get(r.id);
      return {
        id: prev?.id ?? `ar_${r.id}`,
        owner: me,
        createdBy: me,
        listId: REMINDERS_LIST_ID,
        title: f.title,
        notes: f.notes,
        dueDate: f.dueDate,
        dueTime: f.dueTime,
        timezone: deviceTimeZone(),
        rrule: null,
        exdates: [],
        overrides: {},
        completed: f.completed,
        completedDates: [],
        earlyReminders: [],
        tags: r.list ? [r.list.toLowerCase().replace(/\s+/g, "-")] : [],
        flagged: false,
        priority: 0,
        source: REMINDERS_SOURCE,
        externalRefs: [{ source: REMINDERS_SOURCE, accountId: me, calendarId: r.list, externalId: r.id, updatedAt: now }],
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      } as Task;
    });
    const lists: TaskList[] = s.lists.some((l) => l.id === REMINDERS_LIST_ID)
      ? s.lists
      : [...s.lists, { id: REMINDERS_LIST_ID, name: "Apple Reminders", color: "#ff4245", icon: "checkmark", order: 99, createdBy: me, createdAt: now, updatedAt: now }];
    return { tasks: [...others, ...imported], lists };
  });
}

let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;

/** One sync: read, write back GOOYA's changes, send to GOOYA. `force` skips the once-a-minute limit. */
export function syncReminders(force = false): Promise<void> {
  const state = useReminders.getState();
  if (!state.enabled) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve();
  const me = useSession.getState().me;
  const { loaded } = useData.getState();
  // GOOYA's side must be known before anything is written back (or overwritten).
  if (!me || (!isMock && !(loaded.tasks && loaded.users))) return Promise.resolve();
  lastRun = Date.now();
  running = (async () => {
    useReminders.setState({ syncing: true });
    try {
      if (!(await hasAccess())) throw new Error("GOOYA can't read Reminders. Turn it on in Settings → Apps → GOOYA → Reminders.");
      const { reminders: device, objects } = await readDeviceReminders();
      const { baseline } = useReminders.getState();
      const plan = planReminderSync(device, useData.getState().tasks, baseline, me);
      if (plan.changes.length) await writeBack(plan.changes, objects);
      if (isMock) importLocally(plan.reminders);
      else {
        const token = await ensureToken();
        if (!token) throw new Error("Not signed in.");
        const res = await fetch(`${env.functionsUrl}/remindersImport`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, full: true, timezone: deviceTimeZone(), reminders: plan.reminders.map(toImport) }),
        });
        if (!res.ok) throw new Error(`GOOYA's server answered ${res.status}. Try again in a minute.`);
      }
      useReminders.setState({ baseline: baselineOf(plan.reminders), lastSync: Date.now(), lastCount: plan.reminders.filter((r) => !r.completed).length, lastError: null });
    } catch (e) {
      useReminders.setState({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      useReminders.setState({ syncing: false });
      running = null;
      if (again) {
        again = false;
        void syncReminders(true);
      }
    }
  })();
  return running;
}

let soon: ReturnType<typeof setTimeout> | null = null;

/** A reminder was changed in GOOYA: take it to Reminders in a moment (after the change reaches the local data). */
export function syncRemindersSoon(delay = 1500): void {
  if (!useReminders.getState().enabled) return;
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    void syncReminders(true);
  }, delay);
}

/** Turns the sync on (asking for access) or off. Off also takes the reminders out of GOOYA. */
export async function setRemindersEnabled(on: boolean): Promise<boolean> {
  try {
    return await setEnabled(on);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("Reminders", message);
    useReminders.setState({ lastError: `Couldn't turn Reminders ${on ? "on" : "off"}: ${message}` });
    return false;
  }
}

async function setEnabled(on: boolean): Promise<boolean> {
  if (on) {
    const granted = await requestRemindersAccess();
    if (!granted) {
      useReminders.setState({ enabled: false, lastError: "GOOYA can't read Reminders. Turn it on in Settings → Apps → GOOYA → Reminders." });
      return false;
    }
    useReminders.setState({ enabled: true, lastError: null });
    await loadReminderLists().catch(() => undefined);
    await syncReminders(true);
    return true;
  }
  useReminders.setState({ enabled: false, baseline: {}, lastSync: null, lastCount: 0, lastError: null });
  // Take this person's reminders out of GOOYA (nothing is deleted in Reminders).
  if (isMock) importLocally([]);
  else {
    const token = await ensureToken().catch(() => null);
    if (token) {
      await fetch(`${env.functionsUrl}/remindersImport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full: true, timezone: deviceTimeZone(), reminders: [] }),
      }).catch(() => undefined);
    }
  }
  return true;
}

export function setReminderListIncluded(listId: string, included: boolean): void {
  useReminders.setState((s) => ({ excluded: included ? s.excluded.filter((id) => id !== listId) : [...new Set([...s.excluded, listId])] }));
  void syncReminders(true);
}

/**
 * Deleting a task that came from this phone's Reminders deletes the reminder too, as Apple Calendar's "Delete
 * Reminder" does. Returns false when the task is someone else's reminder (it would only come back).
 */
export async function deleteReminderOf(task: Task): Promise<"deleted" | "not-mine" | "not-reminder"> {
  const id = reminderIdOf(task);
  if (!id) return "not-reminder";
  const me = useSession.getState().me;
  if (task.owner !== me || !useReminders.getState().enabled) return "not-mine";
  try {
    const reminder = await Calendar.ExpoCalendarReminder.get(id);
    await reminder.delete();
  } catch {
    // Already gone from Reminders.
  }
  useReminders.setState((s) => {
    const baseline = { ...s.baseline };
    delete baseline[id];
    return { baseline };
  });
  return "deleted";
}

/** Whose Reminders a task came from, for the details sheet ("구야's Apple Reminders"). */
export function reminderOwnerName(task: Task): string | null {
  if (!reminderIdOf(task)) return null;
  return useData.getState().users[task.owner]?.name || PEOPLE[task.owner]?.name || null;
}

let started = false;

/** Keeps Reminders in step while the app runs. Called once the data listeners start. */
export function startRemindersSync(): void {
  if (started) return;
  started = true;
  AppState.addEventListener("change", (s) => {
    if (s === "active") void syncReminders();
  });
  // The first sync once this phone's settings are read and GOOYA's tasks and people have arrived.
  const ready = () => {
    const { loaded } = useData.getState();
    return isMock || (loaded.tasks && loaded.users);
  };
  const kick = () => setTimeout(() => void syncReminders(true), 800);
  const afterSettings = () => {
    if (ready()) return kick();
    const unsub = useData.subscribe(() => {
      if (!ready()) return;
      unsub();
      kick();
    });
  };
  if (useReminders.persist.hasHydrated()) afterSettings();
  else useReminders.persist.onFinishHydration(afterSettings);
}
