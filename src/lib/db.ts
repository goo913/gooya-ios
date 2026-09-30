import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, type DocumentData, type QuerySnapshot, type QueryDocumentSnapshot } from "@react-native-firebase/firestore";
import { DEFAULT_LIST_ID, type CalendarEvent, type Routine, type Schedule, type Task, type TaskList, type UserDoc } from "@shared/model";
import { normalizeEvent, normalizeList, normalizeRoutine, normalizeSchedule, normalizeTask, normalizeUser } from "@shared/normalize";
import { PERSON_KEYS, otherPerson, type PersonKey } from "@shared/people";
import type { LastEdit } from "@shared/reminders";
import { useData, type IntegrationAccount } from "@/store/data";
import { useSession } from "@/store/session";
import { db } from "./firebase";
import { isMock, startMockData } from "./mock";
import { startWidgetSync } from "./widget";

type Snap = QueryDocumentSnapshot<DocumentData>;

export const taskFromSnap = (snap: Snap): Task => normalizeTask(snap.id, snap.data());
/** null for a routine an older build left in "schedules" (it is in "routines" now). */
export const scheduleFromSnap = (snap: Snap): Schedule | null => normalizeSchedule(snap.id, snap.data());
export const routineFromSnap = (snap: Snap): Routine => normalizeRoutine(snap.id, snap.data());
export const userFromSnap = (snap: Snap): UserDoc | null => normalizeUser(snap.id, snap.data());
export const listFromSnap = (snap: Snap): TaskList => normalizeList(snap.id, snap.data());

export function defaultList(): TaskList {
  const now = Date.now();
  return { id: DEFAULT_LIST_ID, name: "Tasks", color: "#0091ff", icon: "list", order: 0, createdBy: "gooya", createdAt: now, updatedAt: now };
}

let started = false;

/**
 * A person's own tasks, schedules or routines, and the other person's shared ones: two queries, one list. The other
 * person's private ones (Share off) are never asked for, so they never reach this phone. `onData` gets the documents
 * once both queries have answered, whether both answers came from the server (not only this phone's copy), and whether
 * a document changed (not only where the answer came from).
 */
function subscribeVisible(name: "tasks" | "schedules" | "routines", me: PersonKey, onData: (docs: Snap[], fromServer: boolean, changed: boolean) => void): void {
  const parts: { docs: Snap[] | null; fresh: boolean }[] = [
    { docs: null, fresh: false },
    { docs: null, fresh: false },
  ];
  const queries = [query(collection(db, name), where("owner", "==", me)), query(collection(db, name), where("owner", "==", otherPerson(me)), where("private", "==", false))];
  queries.forEach((q, i) =>
    onSnapshot(q, { includeMetadataChanges: true }, (qs: QuerySnapshot<DocumentData>) => {
      const first = !parts[i].docs;
      parts[i] = { docs: qs.docs, fresh: !qs.metadata.fromCache };
      if (parts.every((p) => p.docs)) onData([...parts[0].docs!, ...parts[1].docs!], parts.every((p) => p.fresh), first || qs.docChanges().length > 0);
    }),
  );
}

/** Subscribe to everything (tiny dataset; the offline cache makes this cheap). */
export function startData(): void {
  if (started) return;
  started = true;
  if (isMock) {
    startMockData();
    startWidgetSync();
    return;
  }
  startWidgetSync();
  const { setTasks, setSchedules, setRoutines, setUsers, setLists, setFresh } = useData.getState();
  const me = useSession.getState().me ?? "gooya";
  // Metadata changes too, to know when the tasks and lists have come from the server (Reminders sync waits for that).
  subscribeVisible("tasks", me, (docs, fromServer, changed) => {
    if (changed || !useData.getState().loaded.tasks) setTasks(docs.map(taskFromSnap));
    setFresh("tasks", fromServer);
  });
  onSnapshot(collection(db, "lists"), { includeMetadataChanges: true }, (qs) => {
    const lists = qs.docs.map(listFromSnap);
    if (!qs.metadata.fromCache && !lists.some((l) => l.id === DEFAULT_LIST_ID)) {
      const { id, ...rest } = defaultList();
      void setDoc(doc(db, "lists", id), rest).catch(() => undefined);
    }
    if (qs.docChanges().length || !useData.getState().loaded.lists) setLists(lists.length ? lists : [defaultList()]);
    setFresh("lists", !qs.metadata.fromCache);
  });
  subscribeVisible("schedules", me, (docs, _fresh, changed) => changed && setSchedules(docs.map(scheduleFromSnap).filter((s): s is Schedule => !!s)));
  subscribeVisible("routines", me, (docs, _fresh, changed) => changed && setRoutines(docs.map(routineFromSnap)));
  onSnapshot(collection(db, "events"), (qs) => {
    useData.getState().setEvents(qs.docs.map((d) => normalizeEvent(d.id, d.data())).filter((e) => !e.deleted));
  });
  if (useSession.getState().me) {
    onSnapshot(collection(db, "integrations", me, "accounts"), (qs) => {
      useData.getState().setAccounts(qs.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IntegrationAccount, "id">) })));
    });
  }
  onSnapshot(collection(db, "users"), (qs) => {
    const users: Partial<Record<PersonKey, UserDoc>> = {};
    for (const d of qs.docs) {
      const u = userFromSnap(d);
      if (u) users[u.key] = u;
    }
    for (const k of PERSON_KEYS) if (!users[k]) delete users[k];
    setUsers(users);
  });
}

// ---------------------------------------------------------------- writes

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function newId(): string {
  if (isMock) return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return doc(collection(db, "tasks")).id;
}

/** Marks a write as the app's (the server then wakes the iPhone that keeps a changed reminder; shared/reminders.ts). */
const FROM_APP = { lastEdit: "app" satisfies LastEdit };

export async function saveTask(task: Task): Promise<void> {
  const { id, ...rest } = task;
  if (isMock) return useData.setState((s) => ({ tasks: [...s.tasks.filter((t) => t.id !== id), task] }));
  await setDoc(doc(db, "tasks", id), stripUndefined({ ...rest, ...FROM_APP, updatedAt: Date.now() }));
}

export async function patchTask(id: string, patch: Partial<Task>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));
  await updateDoc(doc(db, "tasks", id), stripUndefined({ ...patch, ...FROM_APP, updatedAt: Date.now() }));
}

export async function deleteTask(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  await deleteDoc(doc(db, "tasks", id));
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
  const { id, ...rest } = schedule;
  if (isMock) return useData.setState((s) => ({ schedules: [...s.schedules.filter((x) => x.id !== id), { ...schedule, updatedAt: Date.now() }] }));
  await setDoc(doc(db, "schedules", id), stripUndefined({ ...rest, updatedAt: Date.now() }));
}

export async function patchSchedule(id: string, patch: Partial<Schedule>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ schedules: s.schedules.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x)) }));
  await updateDoc(doc(db, "schedules", id), stripUndefined({ ...patch, updatedAt: Date.now() }));
}

export async function deleteSchedule(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ schedules: s.schedules.filter((x) => x.id !== id) }));
  await deleteDoc(doc(db, "schedules", id));
}

export async function saveRoutine(routine: Routine): Promise<void> {
  const { id, ...rest } = routine;
  if (isMock) return useData.setState((s) => ({ routines: [...s.routines.filter((t) => t.id !== id), routine] }));
  await setDoc(doc(db, "routines", id), stripUndefined({ ...rest, updatedAt: Date.now() }));
}

export async function patchRoutine(id: string, patch: Partial<Routine>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ routines: s.routines.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));
  await updateDoc(doc(db, "routines", id), stripUndefined({ ...patch, updatedAt: Date.now() }));
}

export async function deleteRoutine(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ routines: s.routines.filter((t) => t.id !== id) }));
  await deleteDoc(doc(db, "routines", id));
}

export async function patchUser(key: PersonKey, patch: Record<string, unknown>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ users: { ...s.users, [key]: { ...(s.users[key] as UserDoc), ...patch } } }));
  await setDoc(doc(db, "users", key), stripUndefined(patch), { merge: true });
}

/** Deep-merges settings: users/{key}.settings.<field>. */
export async function patchSettings(key: PersonKey, patch: Record<string, unknown>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ users: { ...s.users, [key]: { ...(s.users[key] as UserDoc), settings: { ...(s.users[key]?.settings ?? {}), ...patch } } } }));
  await setDoc(doc(db, "users", key), { settings: stripUndefined(patch) }, { merge: true });
}

export async function saveList(list: TaskList): Promise<void> {
  const { id, ...rest } = list;
  if (isMock) return useData.setState((s) => ({ lists: [...s.lists.filter((l) => l.id !== id), list].sort((a, b) => a.order - b.order) }));
  await setDoc(doc(db, "lists", id), stripUndefined({ ...rest, updatedAt: Date.now() }));
}

export async function deleteList(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ lists: s.lists.filter((l) => l.id !== id) }));
  await deleteDoc(doc(db, "lists", id));
}

export async function patchAccount(me: PersonKey, accountId: string, patch: Record<string, unknown>): Promise<void> {
  if (isMock) return;
  await setDoc(doc(db, "integrations", me, "accounts", accountId), patch, { merge: true });
}

export async function deleteAccount(me: PersonKey, accountId: string): Promise<void> {
  if (isMock) return;
  await deleteDoc(doc(db, "integrations", me, "accounts", accountId));
}

/** Local edit of an imported (two-way) event: the sync function pushes it out. */
export async function patchEvent(id: string, patch: Record<string, unknown>): Promise<void> {
  if (isMock) {
    return useData.setState((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...(patch as object), updatedAt: Date.now() } : e)).filter((e) => !e.deleted) }));
  }
  await updateDoc(doc(db, "events", id), stripUndefined({ ...patch, dirty: true, updatedAt: Date.now() }));
}

export async function saveEventLocal(ev: CalendarEvent): Promise<void> {
  const { id, ...rest } = ev;
  if (isMock) return useData.setState((s) => ({ events: [...s.events, ev] }));
  await setDoc(doc(db, "events", id), stripUndefined({ ...rest }));
}
