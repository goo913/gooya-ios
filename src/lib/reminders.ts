import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Task, TaskList } from "@shared/model";
import { PEOPLE } from "@shared/people";
import {
  LEGACY_REMINDERS_LIST_ID,
  REMINDERS_SOURCE,
  applyReminderImport,
  baselineOf,
  gooyaPriority,
  isReminderList,
  planReminderSync,
  reminderIdOf,
  toImport,
  type DeviceList,
  type DeviceReminder,
  type ReminderFields,
  type ReminderPlan,
} from "@shared/reminders";
import { deviceTimeZone } from "@shared/time";
import { getMessaging, onMessage } from "@react-native-firebase/messaging";
import { formatShortDate, formatTime12 } from "@shared/fmt";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useData } from "@/store/data";
import { useSession } from "@/store/session";
import * as Native from "../../modules/gooya-reminders";
import { newId, patchUser } from "./db";
import { env } from "./env";
import { isMock } from "./mock";

/**
 * Apple Reminders ⇄ GOOYA from the iPhone itself: the app reads this phone's Reminders with EventKit (the GooyaReminders
 * native module), takes GOOYA's changes to them (completed, renamed, re-dated, notes, priority, moved to another list,
 * deleted), makes reminders for tasks made in GOOYA in a Reminders list, and sends the result to the server's
 * remindersImport, where each Reminders list is a GOOYA list of this person. shared/reminders.ts decides which side wins.
 *
 * It runs when the app opens or comes back to the front, when something changes in Reminders while GOOYA is open, a
 * moment after a reminder is changed in GOOYA, on Sync Now, and when the server's silent push says one of this
 * person's reminders was changed elsewhere (the other person's GOOYA, another device). Only one device per person does
 * this, the one where it was turned on last (users/{me}.remindersDevice).
 */

export type ReminderListInfo = DeviceList & { source?: string };

interface RemindersState {
  /** Turned on in Settings → Calendar integrations on this phone. */
  enabled: boolean;
  /** Reminders lists left out (EventKit calendar ids). */
  excluded: string[];
  /** What GOOYA and this phone last agreed on, per reminder id. */
  baseline: Record<string, ReminderFields>;
  /** Reminders this phone made for GOOYA tasks, until GOOYA has taken them over (task id → reminder id). */
  links: Record<string, string>;
  lastSync: number | null;
  lastCount: number;
  lastError: string | null;
  /** Changes GOOYA could not make in Reminders at the last sync (a read-only list, a reminder gone). */
  problems: string[];
  /** "denied" once the person said no to Reminders access (Settings → GOOYA turns it on again). */
  access: "granted" | "denied" | "undetermined";
  syncing: boolean;
  lists: ReminderListInfo[];
  /** This device, for the one-device rule (made once). */
  deviceId: string;
  /** What the last sync that changed anything in Reminders changed there, as sentences. */
  sent: { at: number; lines: string[] } | null;
}

export const useReminders = create<RemindersState>()(
  persist(
    (): RemindersState => ({
      enabled: false,
      excluded: [],
      baseline: {},
      links: {},
      lastSync: null,
      lastCount: 0,
      lastError: null,
      problems: [],
      access: "undetermined",
      syncing: false,
      lists: [],
      deviceId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      sent: null,
    }),
    {
      name: "gooya-reminders",
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // Version 1 (expo-calendar) had the same reminder ids and a baseline without list and priority; those two are
      // filled in from the phone at the next sync.
      migrate: (persisted) => ({ links: {}, problems: [], ...(persisted as Partial<RemindersState>) }) as RemindersState,
      partialize: (s) => ({
        enabled: s.enabled,
        excluded: s.excluded,
        baseline: s.baseline,
        links: s.links,
        lastSync: s.lastSync,
        lastCount: s.lastCount,
        lastError: s.lastError,
        problems: s.problems,
        access: s.access,
        lists: s.lists,
        deviceId: s.deviceId,
        sent: s.sent,
      }),
    },
  ),
);

const COMPLETED_DAYS = 30;
const MIN_GAP_MS = 10_000;

function deviceReminder(r: Native.NativeReminder): DeviceReminder {
  return {
    id: r.id,
    title: r.title.trim() || "(No title)",
    notes: r.notes,
    url: r.url,
    dueDate: r.dueDate,
    dueTime: r.dueDate ? r.dueTime : null,
    completed: r.completed,
    list: r.list,
    listId: r.listId,
    priority: r.priority,
  };
}

function setAccess(status: string): boolean {
  useReminders.setState({ access: status === "granted" ? "granted" : status === "denied" || status === "restricted" ? "denied" : "undetermined" });
  return status === "granted";
}

/** Asks for Reminders access (the system prompt, once). */
export async function requestRemindersAccess(): Promise<boolean> {
  const granted = await Native.requestAccess();
  return setAccess(granted ? "granted" : Native.authorization());
}

/** The Reminders lists on this phone (for choosing which ones GOOYA shows). */
export async function loadReminderLists(): Promise<ReminderListInfo[]> {
  const lists = (await Native.lists()).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.title.localeCompare(b.title));
  useReminders.setState({ lists });
  return lists;
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

/** Demo mode's stand-in for the server's short hashes (list and task ids). */
function demoHash(s: string, n: number): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(4).slice(0, n);
}

interface ImportBody {
  full: boolean;
  timezone: string;
  lists: DeviceList[];
  reminders: ReturnType<typeof toImport>[];
  unlink: string[];
}

/** Demo mode has no server: the reminders become tasks right here, by the server's rules. */
function importLocally(body: ImportBody): { kept: number } {
  const me = useSession.getState().me ?? "gooya";
  const { tasks, lists } = useData.getState();
  const out = applyReminderImport(me, tasks.filter((t) => t.owner === me), lists, body, Date.now(), demoHash);
  const listsNext = [...lists.filter((l) => l.id !== LEGACY_REMINDERS_LIST_ID && !out.deleteLists.includes(l.id) && !out.lists.some((n) => n.id === l.id)), ...out.lists];
  const tasksNext = tasks.filter((t) => !out.deleteTasks.includes(t.id));
  for (const w of out.tasks) {
    const i = tasksNext.findIndex((t) => t.id === w.id);
    if (i >= 0) tasksNext[i] = { ...tasksNext[i], ...w.fields } as Task;
    else tasksNext.push({ id: w.id, ...w.fields } as Task);
  }
  useData.setState({ tasks: tasksNext, lists: listsNext.sort((a, b) => a.order - b.order) });
  return { kept: out.kept };
}

async function send(body: ImportBody): Promise<{ kept: number }> {
  if (isMock) return importLocally(body);
  const token = await ensureToken();
  if (!token) throw new Error("Not signed in.");
  const res = await fetch(`${env.functionsUrl}/remindersImport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...body }),
  });
  if (!res.ok) throw new Error(`GOOYA's server answered ${res.status}. Try again in a minute.`);
  return (await res.json()) as { kept: number };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A baseline from before lists and priority were kept: those two are taken as the phone has them now. */
function completeBaseline(baseline: Record<string, ReminderFields>, device: DeviceReminder[]): Record<string, ReminderFields> {
  const out = { ...baseline };
  for (const r of device) {
    const b = out[r.id];
    if (b && (b.listId === undefined || b.priority === undefined)) out[r.id] = { ...b, listId: b.listId ?? r.listId, priority: b.priority ?? gooyaPriority(r.priority) };
  }
  return out;
}

/**
 * Carries out a plan on the phone: changes, new reminders, deletions. What could not be done stays as the phone has it
 * (so GOOYA shows the truth), and is said in `problems`.
 */
async function carryOut(plan: ReminderPlan, device: DeviceReminder[], tasksByReminder: Map<string, Task>): Promise<{ reminders: DeviceReminder[]; taskIds: Record<string, string>; problems: string[]; sent: string[] }> {
  const problems: string[] = [];
  const sent: string[] = [];
  const moved: Record<string, string> = {};
  const reminders = [...plan.reminders];
  const onPhone = new Map(device.map((r) => [r.id, r]));
  const replace = (id: string, next: DeviceReminder) => {
    const i = reminders.findIndex((r) => r.id === id);
    if (i >= 0) reminders[i] = next;
    else reminders.push(next);
  };
  for (const c of plan.changes) {
    try {
      const saved = await Native.save({
        id: c.id,
        ...(c.listId !== undefined ? { listId: c.listId } : {}),
        ...(c.title !== undefined ? { title: c.title } : {}),
        ...(c.notes !== undefined ? { notes: c.notes } : {}),
        ...(c.dueDate !== undefined ? { setDue: true, dueDate: c.dueDate, dueTime: c.dueTime ?? null } : {}),
        ...(c.completed !== undefined ? { completed: c.completed } : {}),
        ...(c.priority !== undefined ? { priority: c.priority } : {}),
      });
      // Moving to a list in another account gives the reminder a new id: it stays the same GOOYA task.
      if (saved.id !== c.id) {
        const i = reminders.findIndex((r) => r.id === c.id);
        if (i >= 0) reminders.splice(i, 1);
        const task = tasksByReminder.get(c.id);
        if (task) moved[saved.id] = task.id;
      }
      replace(saved.id, deviceReminder(saved));
      sent.push(`“${saved.title || tasksByReminder.get(c.id)?.title || "A reminder"}” ${changeWords(c, saved).join(", ")}`);
    } catch (e) {
      problems.push(`“${tasksByReminder.get(c.id)?.title ?? onPhone.get(c.id)?.title ?? "A reminder"}”: ${message(e)}`);
      const was = onPhone.get(c.id);
      if (was) replace(c.id, was);
    }
  }
  const links = { ...useReminders.getState().links };
  for (const c of plan.creates) {
    try {
      const saved = await Native.save({ listId: c.listId, title: c.title, notes: c.notes, setDue: !!c.dueDate, dueDate: c.dueDate, dueTime: c.dueTime, alarmAtDue: !!c.dueTime, completed: c.completed, priority: c.priority });
      links[c.taskId] = saved.id;
      // Remembered at once: if the app stops before GOOYA hears of it, the next sync does not make it twice.
      useReminders.setState({ links: { ...links } });
      reminders.push(deviceReminder(saved));
      sent.push(`“${c.title}” added to ${saved.list || "Reminders"}`);
    } catch (e) {
      problems.push(`“${c.title}” couldn't be added to Reminders: ${message(e)}`);
    }
  }
  for (const id of plan.deletes) {
    try {
      await Native.remove(id);
      sent.push(`“${onPhone.get(id)?.title ?? "A reminder"}” deleted`);
    } catch (e) {
      problems.push(`“${onPhone.get(id)?.title ?? "A reminder"}” couldn't be deleted in Reminders: ${message(e)}`);
      const was = onPhone.get(id);
      if (was) reminders.push(was);
    }
  }
  const ids = new Set(reminders.map((r) => r.id));
  const taskIds: Record<string, string> = { ...moved };
  for (const [taskId, rid] of Object.entries(links)) if (ids.has(rid)) taskIds[rid] = taskId;
  return { reminders, taskIds, problems, sent };
}

/** "moved to Mon, Sep 28, 10:00 AM", "completed", … for the sync's record of what it changed in Reminders. */
function changeWords(c: ReminderPlan["changes"][number], saved: Native.NativeReminder): string[] {
  const words: string[] = [];
  if (c.completed !== undefined) words.push(c.completed ? "completed" : "marked not completed");
  if (c.dueDate !== undefined) words.push(c.dueDate ? `moved to ${formatShortDate(c.dueDate)}${c.dueTime ? `, ${formatTime12(Date.parse(`1970-01-01T${c.dueTime}:00Z`), "UTC")}` : ""}` : "given no date");
  if (c.title !== undefined) words.push("renamed");
  if (c.notes !== undefined) words.push("notes changed");
  if (c.listId !== undefined) words.push(`moved to the list “${saved.list}”`);
  if (c.priority !== undefined) words.push("priority changed");
  return words;
}

/** This device's name for the one-device rule: "iPhone", "iPad" or "Mac". */
function deviceName(): string {
  return Native.isMac() ? "Mac" : Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";
}

/** The device syncing this person's reminders when it is another one than this (the one-device rule). */
export function remindersElsewhere(): { id: string; name: string; at: number } | null {
  const me = useSession.getState().me;
  const owner = me ? useData.getState().users[me]?.remindersDevice : null;
  return owner && owner.id !== useReminders.getState().deviceId ? owner : null;
}

let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;
/** Until then, Reminders' change notices are GOOYA's own saves coming back. */
let quietUntil = 0;

/** One sync: read, take GOOYA's changes to Reminders, send the result to GOOYA. `force` skips the 10-second limit. */
export function syncReminders(force = false): Promise<void> {
  const state = useReminders.getState();
  if (!state.enabled) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve();
  const me = useSession.getState().me;
  const { loaded, fresh } = useData.getState();
  // GOOYA's side must be known, from the server, before anything is written to Reminders or deleted there.
  if (!me || (!isMock && !(loaded.tasks && loaded.users && loaded.lists && fresh.tasks && fresh.lists))) return Promise.resolve();
  lastRun = Date.now();
  running = (async () => {
    useReminders.setState({ syncing: true });
    let kept = 0;
    try {
      if (!Native.isAvailable) throw new Error("This GOOYA build can't reach Reminders. Install the latest build.");
      // One device per person syncs Reminders; the first one to sync since the rule came takes it.
      const elsewhere = remindersElsewhere();
      if (elsewhere) throw new Error(`Your reminders sync on your ${elsewhere.name}. Turn Sync My Reminders off and on here to sync them on this ${deviceName()} instead.`);
      if (!useData.getState().users[me]?.remindersDevice) await patchUser(me, { remindersDevice: { id: useReminders.getState().deviceId, name: deviceName(), at: Date.now() } });
      if (!setAccess(Native.authorization())) throw new Error("GOOYA can't read Reminders. Turn it on in Settings → Apps → GOOYA → Reminders.");
      const allLists = await loadReminderLists();
      const { excluded } = useReminders.getState();
      const included = allLists.filter((l) => !excluded.includes(l.id));
      const device = (await Native.reminders(included.map((l) => l.id), Date.now() - COMPLETED_DAYS * 86_400_000)).map(deviceReminder);
      const { tasks, lists } = useData.getState();
      const baseline = completeBaseline(useReminders.getState().baseline, device);
      const writable = new Set(included.filter((l) => l.writable).map((l) => l.id));
      const plan = planReminderSync(device, tasks, baseline, me, lists, useReminders.getState().links, writable);
      // Many reminders at once looking deleted in GOOYA is more likely a problem than a wish: they stay.
      const skipped = plan.deletes.length > 10 && plan.deletes.length > device.length * 0.3 ? plan.deletes.splice(0) : [];
      if (skipped.length) plan.reminders.push(...device.filter((r) => skipped.includes(r.id)));
      const tasksByReminder = new Map<string, Task>();
      for (const t of tasks) {
        const rid = t.owner === me ? reminderIdOf(t) : null;
        if (rid) tasksByReminder.set(rid, t);
      }
      quietUntil = Date.now() + 4000;
      const done = await carryOut(plan, device, tasksByReminder);
      const answer = await send({
        full: true,
        timezone: deviceTimeZone(),
        lists: included.map(({ id, title, color, writable: w, isDefault }) => ({ id, title, color, writable: w, isDefault })),
        reminders: done.reminders.map((r) => toImport(r, { taskId: done.taskIds[r.id], base: baseline[r.id] })),
        unlink: plan.unlink.map((u) => u.taskId),
      });
      kept = answer.kept ?? 0;
      // Tasks moved in GOOYA to its own lists stay there; their reminders go now that GOOYA has kept the tasks.
      for (const u of plan.unlink) await Native.remove(u.reminderId).catch(() => false);
      quietUntil = Date.now() + 4000;
      const taken = new Set(Object.values(done.taskIds));
      const links = Object.fromEntries(Object.entries(useReminders.getState().links).filter(([taskId]) => !taken.has(taskId)));
      const problems = [...done.problems, ...(skipped.length ? [`${skipped.length} reminders look deleted in GOOYA, so they were kept in Reminders. Delete them there if that is what you want.`] : [])];
      useReminders.setState({ baseline: baselineOf(done.reminders), links, lastSync: Date.now(), lastCount: done.reminders.filter((r) => !r.completed).length, lastError: null, problems, ...(done.sent.length ? { sent: { at: Date.now(), lines: done.sent } } : {}) });
    } catch (e) {
      useReminders.setState({ lastError: message(e) });
    } finally {
      useReminders.setState({ syncing: false });
      running = null;
      // GOOYA kept a change made there a moment ago: take it to Reminders once this phone has it.
      if (kept > 0) setTimeout(() => void syncReminders(true), 2500);
      if (again) {
        again = false;
        setTimeout(() => void syncReminders(true), 300);
      }
    }
  })();
  return running;
}

let soon: ReturnType<typeof setTimeout> | null = null;

/** A task was changed in GOOYA: take it to Reminders in a moment (after the change reaches the local data). */
export function syncRemindersSoon(delay = 1500): void {
  if (!useReminders.getState().enabled) return;
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    void syncReminders(true);
  }, delay);
}

/** Turns the sync on (asking for access) or off. Off also takes the reminders and their lists out of GOOYA. */
export async function setRemindersEnabled(on: boolean): Promise<boolean> {
  try {
    return await setEnabled(on);
  } catch (e) {
    console.warn("Reminders", message(e));
    useReminders.setState({ lastError: `Couldn't turn Reminders ${on ? "on" : "off"}: ${message(e)}` });
    return false;
  }
}

async function setEnabled(on: boolean): Promise<boolean> {
  if (on) {
    if (!Native.isAvailable) throw new Error("this GOOYA build can't reach Reminders. Install the latest build.");
    const granted = await requestRemindersAccess();
    if (!granted) {
      useReminders.setState({ enabled: false, lastError: "GOOYA can't read Reminders. Turn it on in Settings → Apps → GOOYA → Reminders." });
      return false;
    }
    useReminders.setState({ enabled: true, lastError: null, problems: [] });
    const me = useSession.getState().me;
    // This device syncs this person's reminders from now on (another one that did stops at its next sync).
    if (me) await patchUser(me, { remindersDevice: { id: useReminders.getState().deviceId, name: deviceName(), at: Date.now() } });
    await loadReminderLists().catch(() => undefined);
    await syncReminders(true);
    return true;
  }
  const me = useSession.getState().me;
  if (me && !remindersElsewhere() && useData.getState().users[me]?.remindersDevice) await patchUser(me, { remindersDevice: null }).catch(() => undefined);
  useReminders.setState({ enabled: false, baseline: {}, links: {}, lastSync: null, lastCount: 0, lastError: null, problems: [], sent: null });
  // Take this person's reminders and their lists out of GOOYA (nothing is deleted in Reminders).
  await send({ full: true, timezone: deviceTimeZone(), lists: [], reminders: [], unlink: [] }).catch(() => undefined);
  return true;
}

export function setReminderListIncluded(listId: string, included: boolean): void {
  useReminders.setState((s) => ({ excluded: included ? s.excluded.filter((id) => id !== listId) : [...new Set([...s.excluded, listId])] }));
  void syncReminders(true);
}

/**
 * Deleting a task that is one of this phone's reminders deletes the reminder right away, as Apple Calendar's "Delete
 * Reminder" does. Someone else's reminder is deleted by their phone at its next sync (it sees the task gone).
 */
export async function deleteReminderOf(task: Task): Promise<"deleted" | "later" | "not-reminder"> {
  const id = reminderIdOf(task) ?? useReminders.getState().links[task.id] ?? null;
  if (!id) return "not-reminder";
  const me = useSession.getState().me;
  if (task.owner !== me || !useReminders.getState().enabled || !Native.isAvailable) return "later";
  quietUntil = Date.now() + 4000;
  await Native.remove(id).catch(() => false);
  useReminders.setState((s) => {
    const baseline = { ...s.baseline };
    delete baseline[id];
    const links = Object.fromEntries(Object.entries(s.links).filter(([, rid]) => rid !== id));
    return { baseline, links };
  });
  return "deleted";
}

/** Whose Reminders a task is in, for the details sheet ("구야's Reminders"). */
export function reminderOwnerName(task: Task): string | null {
  if (task.source !== REMINDERS_SOURCE && !isReminderList(useData.getState().lists.find((l) => l.id === task.listId))) return null;
  return useData.getState().users[task.owner]?.name || PEOPLE[task.owner]?.name || null;
}

/** The Reminders list a GOOYA list is on this phone, when it is one of this person's. */
export function reminderListOf(list: TaskList | undefined | null): ReminderListInfo | null {
  if (!list || !isReminderList(list) || list.owner !== useSession.getState().me) return null;
  return useReminders.getState().lists.find((l) => l.id === list.externalId) ?? null;
}

/** GOOYA's tasks, lists and people have come from the server (not only from the phone's cache). */
function ready(): boolean {
  const { loaded, fresh } = useData.getState();
  return isMock || (loaded.tasks && loaded.users && loaded.lists && fresh.tasks && fresh.lists);
}

function whenReady(ms: number): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, ms);
    const unsub = useData.subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

/**
 * The server's silent push: one of this person's reminders was changed elsewhere. Syncs once GOOYA's side has come from
 * the server; iOS gives an app woken this way about half a minute.
 */
export async function syncRemindersFromPush(): Promise<void> {
  if (!useReminders.persist.hasHydrated()) await new Promise<void>((resolve) => useReminders.persist.onFinishHydration(() => resolve()));
  if (!useReminders.getState().enabled) return;
  if (await whenReady(20_000)) await syncReminders();
}

let started = false;

/** Keeps Reminders in step while the app runs. Called once the data listeners start. */
export function startRemindersSync(): void {
  if (started) return;
  started = true;
  // The server's silent push while GOOYA is open (with GOOYA closed, src/lib/pushBackground.ts takes it).
  try {
    onMessage(getMessaging(), (m) => {
      if (m.data?.kind === "sync") syncRemindersSoon(800);
    });
  } catch {}
  AppState.addEventListener("change", (s) => {
    if (s === "active") void syncReminders();
  });
  // Changed in Reminders (or on another device, through iCloud) while GOOYA is open.
  let changed: ReturnType<typeof setTimeout> | null = null;
  Native.onChange(() => {
    if (Date.now() < quietUntil || running) return;
    if (changed) clearTimeout(changed);
    changed = setTimeout(() => {
      changed = null;
      if (AppState.currentState === "active") void syncReminders(true);
    }, 1200);
  });
  // The first sync once this phone's settings are read and GOOYA's tasks, lists and people have come from the server.
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
