// Apple Reminders ⇄ GOOYA, the part that needs no phone: how a reminder becomes a GOOYA task, and which side of a
// change wins. The iPhone app reads Reminders with EventKit (src/lib/reminders.ts) and sends them to the server's
// remindersImport (functions/src/integrations/reminders.ts), which applies the same rules as reminderFields below.
//
// Each Reminders list on the iPhone is a GOOYA list (the list's name and colour, owned by that person). A task made in
// GOOYA in one of those lists becomes a reminder there; a reminder deleted, moved or changed on either side is deleted,
// moved or changed on the other. GOOYA's own lists (Tasks, Home, …) stay in GOOYA.

import type { DateKey, HHmm, Priority, Task, TaskList } from './model'

export const REMINDERS_SOURCE = 'apple-reminders'
/** The one list all reminders went into before each Reminders list became a GOOYA list. */
export const LEGACY_REMINDERS_LIST_ID = 'apple-reminders'
/** @deprecated the single list reminders used to go into; kept so older tasks still read as reminders. */
export const REMINDERS_LIST_ID = LEGACY_REMINDERS_LIST_ID

/** A reminder as the iPhone has it (EventKit), in plain values. */
export interface DeviceReminder {
  id: string
  title: string
  notes: string
  url: string
  /** The due day and time on the phone's clock; the time is null for a reminder with a date only. */
  dueDate: DateKey | null
  dueTime: HHmm | null
  completed: boolean
  /** The Reminders list's name ("Groceries"). */
  list: string
  /** The Reminders list's id on this iPhone (EventKit calendar identifier). */
  listId: string
  /** Apple's priority: 0 none, 1–4 high, 5 medium, 6–9 low. */
  priority: number
}

/** A Reminders list as the iPhone has it. */
export interface DeviceList {
  id: string
  title: string
  /** #rrggbb */
  color: string
  /** Reminders lets apps change it (not a subscribed or view-only shared list). */
  writable: boolean
  /** New reminders go here on this iPhone. */
  isDefault: boolean
}

/** One reminder as remindersImport receives it. */
export interface ReminderImport {
  id: string
  title: string
  notes?: string
  url?: string
  dueDate?: DateKey | null
  dueTime?: HHmm | null
  completed: boolean
  list: string
  listId?: string
  priority?: number
  /** The GOOYA task this reminder was just made from (it takes the task over, keeping its id). */
  taskId?: string
  /** What GOOYA and the phone last agreed on for this reminder; a field GOOYA changed since then stays GOOYA's. */
  base?: ReminderFields
}

/** The GOOYA task fields a reminder becomes, and what a change to them is compared with. */
export interface ReminderFields {
  title: string
  notes: string
  dueDate: DateKey | null
  dueTime: HHmm | null
  completed: boolean
  /** GOOYA's priority (0 none … 3 high). */
  priority: Priority
  /** The Reminders list's id on the iPhone. */
  listId: string
}

/** A change made in GOOYA that goes back to a reminder on the iPhone. */
export interface ReminderChange {
  id: string
  title?: string
  notes?: string
  dueDate?: DateKey
  dueTime?: HHmm | null
  completed?: boolean
  /** Apple's priority (0–9). */
  priority?: number
  /** Move to this Reminders list. */
  listId?: string
}

/** A GOOYA task that becomes a new reminder. */
export interface ReminderCreate {
  taskId: string
  listId: string
  title: string
  notes: string
  dueDate: DateKey | null
  dueTime: HHmm | null
  completed: boolean
  priority: number
}

export interface ReminderPlan {
  /** The phone's reminders as they are after the plan is carried out: what GOOYA gets. */
  reminders: DeviceReminder[]
  changes: ReminderChange[]
  creates: ReminderCreate[]
  /** Reminders whose task was deleted in GOOYA: deleted on the phone too. */
  deletes: string[]
  /** Tasks moved in GOOYA from a Reminders list to one of GOOYA's own lists: they stay in GOOYA, their reminders go. */
  unlink: { taskId: string; reminderId: string }[]
}

/** Apple's 0–9 (0 none, 1–4 high, 5 medium, 6–9 low) as GOOYA's 0–3. */
export function gooyaPriority(apple: number): Priority {
  if (!apple) return 0
  if (apple <= 4) return 3
  if (apple === 5) return 2
  return 1
}

/** GOOYA's 0–3 as Apple's priority. */
export function applePriority(p: Priority | number): number {
  return p === 3 ? 1 : p === 2 ? 5 : p === 1 ? 9 : 0
}

export function reminderFields(r: Pick<DeviceReminder, 'title' | 'notes' | 'url' | 'dueDate' | 'dueTime' | 'completed' | 'priority' | 'listId'>): ReminderFields {
  return {
    title: r.title.slice(0, 500),
    notes: [r.notes, r.url].filter(Boolean).join('\n'),
    dueDate: r.dueDate,
    dueTime: r.dueDate ? r.dueTime : null,
    completed: r.completed,
    priority: gooyaPriority(r.priority ?? 0),
    listId: r.listId ?? '',
  }
}

export function toImport(r: DeviceReminder, extra: Pick<ReminderImport, 'taskId' | 'base'> = {}): ReminderImport {
  return {
    id: r.id,
    title: r.title,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.url ? { url: r.url } : {}),
    dueDate: r.dueDate,
    dueTime: r.dueDate ? r.dueTime : null,
    completed: r.completed,
    list: r.list,
    listId: r.listId,
    priority: r.priority,
    ...(extra.taskId ? { taskId: extra.taskId } : {}),
    ...(extra.base ? { base: extra.base } : {}),
  }
}

/** The reminder id a GOOYA task came from, or null for GOOYA's own tasks. */
export function reminderIdOf(task: Pick<Task, 'source' | 'externalRefs'>): string | null {
  if (task.source !== REMINDERS_SOURCE) return null
  return task.externalRefs?.find((r) => r.source === REMINDERS_SOURCE)?.externalId ?? null
}

/** The GOOYA list a person's Reminders list is (the same id on every phone and on the server). */
export function reminderListDocId(person: string, deviceListId: string, hash: (s: string) => string): string {
  return `rl_${hash(`${person}:${deviceListId}`)}`
}

/** Whether a GOOYA list is one of someone's Reminders lists. */
export const isReminderList = (l: Pick<TaskList, 'source'> | undefined | null): boolean => l?.source === REMINDERS_SOURCE

function taskFields(t: Task, deviceListOf: (listId: string) => string | null): ReminderFields {
  return {
    title: t.title,
    notes: t.notes ?? '',
    dueDate: t.dueDate,
    dueTime: t.dueDate ? t.dueTime : null,
    completed: !!t.completed,
    priority: t.priority ?? 0,
    listId: deviceListOf(t.listId) ?? '',
  }
}

const sameDue = (a: Pick<ReminderFields, 'dueDate' | 'dueTime'>, b: Pick<ReminderFields, 'dueDate' | 'dueTime'>) => a.dueDate === b.dueDate && a.dueTime === b.dueTime
const sameFields = (a: ReminderFields, b: ReminderFields) =>
  a.title === b.title && a.notes === b.notes && sameDue(a, b) && a.completed === b.completed && a.priority === b.priority && a.listId === b.listId

/**
 * A three-way merge per reminder: what the iPhone has, what GOOYA has, and what they last agreed on (`baseline`, kept
 * on the phone). A field GOOYA changed since then, and the iPhone did not, goes to the reminder; everything else comes
 * from the iPhone. Without a baseline (the first sync, or a new reminder) the iPhone wins.
 *
 * `lists` are GOOYA's lists: a task's list says which Reminders list its reminder belongs in (the person's own
 * Reminders lists), or that it left Reminders (one of GOOYA's own lists). `links` are tasks this phone has made
 * reminders for and GOOYA has not heard about yet (task id → reminder id).
 *
 * A date cleared in GOOYA is not cleared in Reminders.
 */
export function planReminderSync(
  device: DeviceReminder[],
  tasks: Task[],
  baseline: Record<string, ReminderFields>,
  owner: string,
  lists: TaskList[] = [],
  links: Record<string, string> = {},
  writableLists?: Set<string>,
): ReminderPlan {
  const listById = new Map(lists.map((l) => [l.id, l]))
  const deviceListOf = (listId: string): string | null => {
    const l = listById.get(listId)
    return l && isReminderList(l) && l.owner === owner && l.externalId ? l.externalId : null
  }
  /** What a task's list asks of its reminder: a Reminders list to be in, to leave Reminders, or nothing said. */
  const intentOf = (t: Task): { kind: 'list'; listId: string } | { kind: 'leave' } | { kind: 'none' } => {
    const device = deviceListOf(t.listId)
    if (device) return { kind: 'list', listId: device }
    const l = listById.get(t.listId)
    // One of GOOYA's own lists. (The old single "Apple Reminders" list, or a list not loaded, says nothing.)
    if (l && !isReminderList(l) && t.listId !== LEGACY_REMINDERS_LIST_ID) return { kind: 'leave' }
    return { kind: 'none' }
  }
  const canWrite = (listId: string) => !writableLists || writableLists.has(listId)

  const byReminder = new Map<string, Task>()
  const mine: Task[] = []
  for (const t of tasks) {
    if (t.owner !== owner) continue
    mine.push(t)
    const id = reminderIdOf(t)
    if (id) byReminder.set(id, t)
  }
  const deviceIds = new Set(device.map((r) => r.id))
  // Reminders this phone made for GOOYA tasks that GOOYA does not know as reminders yet.
  const linkedTask = new Map<string, Task>()
  for (const t of mine) {
    const rid = links[t.id]
    if (rid && !reminderIdOf(t) && deviceIds.has(rid)) linkedTask.set(rid, t)
  }

  const plan: ReminderPlan = { reminders: [], changes: [], creates: [], deletes: [], unlink: [] }
  for (const r of device) {
    const task = byReminder.get(r.id) ?? linkedTask.get(r.id)
    const base = baseline[r.id]
    const phone = reminderFields(r)
    if (!task) {
      // Synced before and gone from GOOYA since: deleted in GOOYA. If it changed on the phone meanwhile, it stays.
      if (base && sameFields(phone, base) && canWrite(r.listId)) plan.deletes.push(r.id)
      else plan.reminders.push(r)
      continue
    }
    if (!base || !canWrite(r.listId)) {
      plan.reminders.push(r)
      continue
    }
    const gooya = taskFields(task, deviceListOf)
    const change: ReminderChange = { id: r.id }
    const next = { ...r }
    const intent = intentOf(task)
    const listChangedInGooya = intent.kind !== 'none' && (intent.kind === 'leave' || intent.listId !== base.listId)
    if (listChangedInGooya && r.listId === base.listId) {
      if (intent.kind === 'leave') {
        plan.unlink.push({ taskId: task.id, reminderId: r.id })
        continue
      }
      if (intent.kind === 'list' && canWrite(intent.listId)) {
        change.listId = intent.listId
        next.listId = intent.listId
        next.list = listById.get(task.listId)?.name ?? r.list
      }
    }
    if (gooya.completed !== base.completed && phone.completed === base.completed) {
      change.completed = gooya.completed
      next.completed = gooya.completed
    }
    if (gooya.title.trim() && gooya.title !== base.title && phone.title === base.title) {
      change.title = gooya.title
      next.title = gooya.title
    }
    if (gooya.notes !== base.notes && phone.notes === base.notes) {
      // GOOYA shows the reminder's link under its notes; the link stays the reminder's own.
      const notes = r.url && gooya.notes.endsWith(r.url) ? gooya.notes.slice(0, -r.url.length).replace(/\n$/, '') : gooya.notes
      change.notes = notes
      next.notes = notes
    }
    if (gooya.dueDate && !sameDue(gooya, base) && sameDue(phone, base)) {
      change.dueDate = gooya.dueDate
      change.dueTime = gooya.dueTime
      next.dueDate = gooya.dueDate
      next.dueTime = gooya.dueTime
    }
    if (gooya.priority !== base.priority && phone.priority === base.priority) {
      change.priority = applePriority(gooya.priority)
      next.priority = change.priority
    }
    if (Object.keys(change).length > 1) plan.changes.push(change)
    plan.reminders.push(next)
  }
  // GOOYA's own tasks put in one of this person's Reminders lists become reminders there.
  for (const t of mine) {
    if (reminderIdOf(t) || (links[t.id] && deviceIds.has(links[t.id]))) continue
    const intent = intentOf(t)
    if (intent.kind !== 'list' || !canWrite(intent.listId)) continue
    plan.creates.push({ taskId: t.id, listId: intent.listId, title: t.title, notes: t.notes ?? '', dueDate: t.dueDate, dueTime: t.dueDate ? t.dueTime : null, completed: !!t.completed, priority: applePriority(t.priority ?? 0) })
  }
  return plan
}

/** What GOOYA and the iPhone agree on after a sync: the next sync's baseline. */
export function baselineOf(reminders: DeviceReminder[]): Record<string, ReminderFields> {
  return Object.fromEntries(reminders.map((r) => [r.id, reminderFields(r)]))
}

/**
 * The server's side of the merge. `current` is the task as GOOYA has it now, `incoming` the reminder's fields as the
 * phone sends them, `base` what the phone last agreed on with GOOYA. A field GOOYA changed after the phone's copy of
 * GOOYA was taken (someone else changed it just now), and the phone did not, stays GOOYA's: the phone takes it to the
 * reminder next time. Returns the fields to write and the names of the fields kept.
 */
export function mergeIntoTask(
  current: Pick<Task, 'title' | 'notes' | 'dueDate' | 'dueTime' | 'completed' | 'priority' | 'listId'>,
  incoming: Omit<ReminderFields, 'listId'> & { gooyaListId: string },
  base: (Omit<ReminderFields, 'listId'> & { gooyaListId: string }) | null,
): { fields: Pick<Task, 'title' | 'notes' | 'dueDate' | 'dueTime' | 'completed' | 'priority' | 'listId'>; kept: string[] } {
  const kept: string[] = []
  const pick = <T>(name: string, gooya: T, phone: T, was: T | undefined, same: (a: T, b: T) => boolean = (a, b) => a === b): T => {
    if (base && was !== undefined && !same(gooya, was) && same(phone, was)) {
      kept.push(name)
      return gooya
    }
    return phone
  }
  const due = pick(
    'due',
    { dueDate: current.dueDate, dueTime: current.dueDate ? current.dueTime : null },
    { dueDate: incoming.dueDate, dueTime: incoming.dueDate ? incoming.dueTime : null },
    base ? { dueDate: base.dueDate, dueTime: base.dueDate ? base.dueTime : null } : undefined,
    sameDue,
  )
  return {
    fields: {
      title: pick('title', current.title, incoming.title, base?.title),
      notes: pick('notes', current.notes ?? '', incoming.notes, base?.notes),
      dueDate: due.dueDate,
      dueTime: due.dueTime,
      completed: pick('completed', !!current.completed, incoming.completed, base?.completed),
      priority: pick('priority', current.priority ?? 0, incoming.priority, base?.priority),
      listId: current.listId === LEGACY_REMINDERS_LIST_ID ? incoming.gooyaListId : pick('list', current.listId, incoming.gooyaListId, base?.gooyaListId),
    },
    kept,
  }
}

// ---------------------------------------------------------------- applying what the phone sends (server and demo)

/** What the phone sends to remindersImport, with due days already on the phone's clock. */
export interface ImportPayload {
  /** The phone's Reminders lists (each becomes a GOOYA list), or undefined from an older app (one "Apple Reminders" list). */
  lists?: DeviceList[]
  reminders: ReminderImport[]
  /** Tasks moved in GOOYA out of Reminders: they stay, as GOOYA's own. */
  unlink?: string[]
  /** Tasks from Reminders missing from `reminders` were deleted there: they go. */
  full: boolean
  /** The phone's time zone. */
  timezone: string
}

export interface ImportOutcome {
  /** Tasks to write: whole new tasks (create) or the fields that changed. */
  tasks: { id: string; create: boolean; fields: Partial<Task> }[]
  deleteTasks: string[]
  lists: TaskList[]
  deleteLists: string[]
  kept: number
  created: number
  updated: number
  removed: number
  unlinked: number
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * The phone's reminders applied to GOOYA: `mine` are the person's tasks now, `lists` all GOOYA lists. Only what
 * differs is written. `hash` makes the ids of lists and tasks (the server's shortHash).
 */
export function applyReminderImport(person: string, mine: Task[], lists: TaskList[], payload: ImportPayload, now: number, hash: (s: string, n: number) => string): ImportOutcome {
  const out: ImportOutcome = { tasks: [], deleteTasks: [], lists: [], deleteLists: [], kept: 0, created: 0, updated: 0, removed: 0, unlinked: 0 }
  const withLists = Array.isArray(payload.lists)
  const deviceLists = (payload.lists ?? []).filter((l) => l && typeof l.id === 'string' && l.id)
  const listIdOf = new Map(deviceLists.map((l) => [l.id, reminderListDocId(person, l.id, (s) => hash(s, 16))]))
  if (withLists) {
    deviceLists.forEach((l, i) => {
      const id = listIdOf.get(l.id)!
      const prev = lists.find((x) => x.id === id)
      const next: TaskList = {
        id,
        name: String(l.title || 'Reminders').slice(0, 100),
        color: HEX_COLOR.test(l.color) ? l.color.toLowerCase() : '#ff9500',
        icon: 'list',
        order: 100 + i,
        createdBy: (prev?.createdBy ?? person) as TaskList['createdBy'],
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        source: REMINDERS_SOURCE,
        owner: person as TaskList['createdBy'],
        externalId: l.id,
        readOnly: l.writable === false,
        isDefault: !!l.isDefault,
      }
      const same = prev && prev.name === next.name && prev.color === next.color && prev.order === next.order && prev.source === next.source && prev.owner === next.owner && prev.externalId === next.externalId && !!prev.readOnly === next.readOnly && !!prev.isDefault === next.isDefault
      if (!same) out.lists.push(next)
    })
    // Lists gone from the phone (deleted there, or left out in GOOYA's settings) go from GOOYA with their reminders.
    for (const l of lists) if (isReminderList(l) && l.owner === person && ![...listIdOf.values()].includes(l.id)) out.deleteLists.push(l.id)
  }
  const byReminder = new Map<string, Task>()
  const byId = new Map(mine.map((t) => [t.id, t]))
  for (const t of mine) {
    const rid = reminderIdOf(t)
    if (rid) byReminder.set(rid, t)
  }
  const seen = new Set<string>()
  const incomingIds = new Set(payload.reminders.map((r) => r?.id))
  const takenOver = new Set<string>()
  for (const r of payload.reminders) {
    if (!r || !r.id || !r.title) continue
    seen.add(r.id)
    let current = byReminder.get(r.id)
    if (!current && r.taskId) {
      // Made from a GOOYA task, or the same reminder under a new id (moved to a list in another account).
      const t = byId.get(r.taskId)
      const was = t ? reminderIdOf(t) : null
      if (t && (!was || !incomingIds.has(was))) {
        current = t
        takenOver.add(t.id)
      }
    }
    const gooyaListId = withLists && r.listId && listIdOf.has(r.listId) ? listIdOf.get(r.listId)! : LEGACY_REMINDERS_LIST_ID
    const dueDate = typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? r.dueDate : null
    const dueTime = dueDate && typeof r.dueTime === 'string' && /^\d{2}:\d{2}$/.test(r.dueTime) ? r.dueTime : null
    const phone = {
      title: String(r.title).slice(0, 500),
      notes: [r.notes, r.url].filter(Boolean).join('\n'),
      dueDate,
      dueTime,
      completed: !!r.completed,
      priority: typeof r.priority === 'number' ? gooyaPriority(r.priority) : ((current?.priority ?? 0) as Priority),
      gooyaListId,
    }
    const base = r.base && current ? { ...r.base, priority: r.base.priority ?? phone.priority, gooyaListId: r.base.listId && listIdOf.has(r.base.listId) ? listIdOf.get(r.base.listId)! : gooyaListId } : null
    const merged = current ? mergeIntoTask(current, phone, base) : { fields: { title: phone.title, notes: phone.notes, dueDate, dueTime, completed: phone.completed, priority: phone.priority, listId: gooyaListId }, kept: [] }
    out.kept += merged.kept.length
    const fields: Partial<Task> = {
      ...merged.fields,
      owner: person as Task['owner'],
      timezone: current?.timezone && current.dueDate === merged.fields.dueDate && current.dueTime === merged.fields.dueTime ? current.timezone : payload.timezone,
      source: REMINDERS_SOURCE,
      externalRefs: [{ source: REMINDERS_SOURCE, accountId: person, calendarId: r.listId ?? r.list ?? '', externalId: r.id }],
    }
    if (!current) {
      out.tasks.push({
        id: `ar_${hash(`${person}:${r.id}`, 20)}`,
        create: true,
        fields: { ...fields, createdBy: person as Task['createdBy'], rrule: null, exdates: [], overrides: {}, completedDates: [], earlyReminders: [], tags: [], flagged: false, createdAt: now, updatedAt: now },
      })
      out.created++
      continue
    }
    const changed = (Object.keys(fields) as (keyof Task)[]).filter((k) => {
      const a = k === 'externalRefs' ? (current!.externalRefs ?? []).map((x) => ({ source: x.source, accountId: x.accountId, calendarId: x.calendarId, externalId: x.externalId })) : current![k]
      return JSON.stringify(a ?? null) !== JSON.stringify(fields[k] ?? null)
    })
    if (!changed.length) continue
    out.tasks.push({ id: current.id, create: false, fields: { ...fields, updatedAt: now } })
    out.updated++
  }
  const unlinked = new Set<string>()
  for (const id of payload.unlink ?? []) {
    const t = byId.get(String(id))
    if (!t || !reminderIdOf(t)) continue
    out.tasks.push({ id: t.id, create: false, fields: { source: 'gooya', externalRefs: [], updatedAt: now } })
    unlinked.add(t.id)
    out.unlinked++
  }
  if (payload.full) {
    for (const [rid, t] of byReminder) {
      if (seen.has(rid) || unlinked.has(t.id) || takenOver.has(t.id)) continue
      out.deleteTasks.push(t.id)
      out.removed++
    }
  }
  return out
}

/** Who wrote a task last: the app (either person, any device), or the iPhone's Reminders sync (remindersImport). */
export type LastEdit = 'app' | 'reminders'

const REMINDER_FIELDS = ['owner', 'title', 'notes', 'dueDate', 'dueTime', 'completed', 'priority', 'listId', 'rrule'] as const

/** A task that is, or is to become, one of its owner's reminders (a reminder, or a task put in a Reminders list). */
function onReminders(d: Record<string, unknown> | null): boolean {
  return !!d && (d.source === REMINDERS_SOURCE || (typeof d.listId === 'string' && d.listId.startsWith('rl_')))
}

/**
 * Whose iPhones to wake with a silent push after a task was written (`before` / `after` are the stored documents,
 * null when there was none): the owners of a reminder that changed anywhere but in their iPhone's own Reminders sync,
 * so the change reaches Reminders now instead of the next time GOOYA opens on that iPhone.
 */
export function reminderWakeups(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (after?.lastEdit === 'reminders') return []
  if (!onReminders(before) && !onReminders(after)) return []
  if (before && after && REMINDER_FIELDS.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null))) return []
  const owners = [before, after].filter((d) => onReminders(d)).map((d) => d?.owner)
  return [...new Set(owners.filter((o): o is string => typeof o === 'string' && !!o))]
}
