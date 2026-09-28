import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, type DocumentData, type QueryDocumentSnapshot } from "@react-native-firebase/firestore";
import { DEFAULT_LIST_ID, type CalendarEvent, type Schedule, type Task, type TaskList, type UserDoc } from "@shared/model";
import { normalizeEvent, normalizeList, normalizeSchedule, normalizeTask, normalizeUser } from "@shared/normalize";
import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { useData, type IntegrationAccount } from "@/store/data";
import { useSession } from "@/store/session";
import { db } from "./firebase";
import { isMock, startMockData } from "./mock";

type Snap = QueryDocumentSnapshot<DocumentData>;

export const taskFromSnap = (snap: Snap): Task => normalizeTask(snap.id, snap.data());
export const scheduleFromSnap = (snap: Snap): Schedule => normalizeSchedule(snap.id, snap.data());
export const userFromSnap = (snap: Snap): UserDoc | null => normalizeUser(snap.id, snap.data());
export const listFromSnap = (snap: Snap): TaskList => normalizeList(snap.id, snap.data());

export function defaultList(): TaskList {
  const now = Date.now();
  return { id: DEFAULT_LIST_ID, name: "Tasks", color: "#0091ff", icon: "list", order: 0, createdBy: "gooya", createdAt: now, updatedAt: now };
}

let started = false;

/** Subscribe to everything (tiny dataset; the offline cache makes this cheap). */
export function startData(): void {
  if (started) return;
  started = true;
  if (isMock) {
    startMockData();
    return;
  }
  const { setTasks, setSchedules, setUsers, setLists } = useData.getState();
  onSnapshot(collection(db, "tasks"), (qs) => setTasks(qs.docs.map(taskFromSnap)));
  onSnapshot(collection(db, "lists"), (qs) => {
    const lists = qs.docs.map(listFromSnap);
    if (!qs.metadata.fromCache && !lists.some((l) => l.id === DEFAULT_LIST_ID)) {
      const { id, ...rest } = defaultList();
      void setDoc(doc(db, "lists", id), rest).catch(() => undefined);
    }
    setLists(lists.length ? lists : [defaultList()]);
  });
  onSnapshot(collection(db, "schedules"), (qs) => setSchedules(qs.docs.map(scheduleFromSnap)));
  onSnapshot(collection(db, "events"), (qs) => {
    useData.getState().setEvents(qs.docs.map((d) => normalizeEvent(d.id, d.data())).filter((e) => !e.deleted));
  });
  const me = useSession.getState().me;
  if (me) {
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

export async function saveTask(task: Task): Promise<void> {
  const { id, ...rest } = task;
  if (isMock) return useData.setState((s) => ({ tasks: [...s.tasks.filter((t) => t.id !== id), task] }));
  await setDoc(doc(db, "tasks", id), stripUndefined({ ...rest, updatedAt: Date.now() }));
}

export async function patchTask(id: string, patch: Partial<Task>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));
  await updateDoc(doc(db, "tasks", id), stripUndefined({ ...patch, updatedAt: Date.now() }));
}

export async function deleteTask(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  await deleteDoc(doc(db, "tasks", id));
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
  const { id, ...rest } = schedule;
  if (isMock) return useData.setState((s) => ({ schedules: [...s.schedules.filter((t) => t.id !== id), schedule] }));
  await setDoc(doc(db, "schedules", id), stripUndefined({ ...rest, updatedAt: Date.now() }));
}

export async function patchSchedule(id: string, patch: Partial<Schedule>): Promise<void> {
  if (isMock) return useData.setState((s) => ({ schedules: s.schedules.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));
  await updateDoc(doc(db, "schedules", id), stripUndefined({ ...patch, updatedAt: Date.now() }));
}

export async function deleteSchedule(id: string): Promise<void> {
  if (isMock) return useData.setState((s) => ({ schedules: s.schedules.filter((t) => t.id !== id) }));
  await deleteDoc(doc(db, "schedules", id));
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
