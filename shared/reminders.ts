// Apple Reminders ⇄ GOOYA, the part that needs no phone: how a reminder becomes a GOOYA task, and which side of a
// change wins. The iPhone app reads Reminders with EventKit (src/lib/reminders.ts) and sends them to the server's
// remindersImport (functions/src/integrations/reminders.ts), which applies the same rules as reminderFields below.
//
// Each Reminders list on the iPhone is a GOOYA list (the list's name and colour, owned by that person) that stands for
// one of GOOYA's categories, which both people share (shared/categories.ts). A task in a category becomes a reminder in
// the owner's list for it, a list the iPhone makes when there is none, named and coloured as the category is (so
// Reminders and Apple Calendar show the category too); a reminder deleted, moved or changed on either side is deleted,
// moved or changed on the other, and a list renamed or recoloured on either side is on the other.

import { categoryKey, isCategory } from './categories'
import type { DateKey, HHmm, Priority, Task, TaskList } from './model'
import { fieldsInZone, formatHHmm, makeKey, zonedMs } from './time'

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
  /**
   * It repeats (Reminders' own repeat, which GOOYA does not model: its task is the reminder's next time). Marked done, in
   * Reminders or from GOOYA, it is not done: Reminders keeps a done copy of that time (a new reminder, its own id, no
   * repeat) and moves this one to its next date after today, not done.
   */
  recurring?: boolean
}

/** A Reminders list as the iPhone has it. */
export interface DeviceList {
  id: string
  title: string
  /** #rrggbb */
  color: string
  /** Reminders lets apps change what is in it (not a subscribed or view-only shared list). */
  writable: boolean
  /** Reminders lets apps rename and recolour it (not someone else's shared list); unknown from older builds. */
  editable?: boolean
  /** New reminders go here on this iPhone. */
  isDefault: boolean
  /** Sent to the server: the category the phone linked this list to (it made the list for it, or found it by name). */
  categoryId?: string
  /** Sent to the server: the list was renamed or recoloured in Reminders, so its category is too. */
  categoryName?: string
  categoryColor?: string
}

/** A Reminders list's name and colour as GOOYA and the iPhone last agreed on them. */
export interface ListFields {
  title: string
  color: string
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
  /** A repeating reminder (DeviceReminder.recurring); missing from older apps. */
  recurring?: boolean
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
  /** GOOYA's side of the fields the plan took into account, per reminder id: for the base sent to the server (sentBase). */
  seen: Record<string, GooyaSide>
}

/** GOOYA's values for a reminder's fields that a sync took into account. */
export interface GooyaSide {
  /** Taken to the reminder (in `changes`). */
  taken: Partial<ReminderFields>
  /** Left out on purpose: a repeating reminder's done mark, and its date, for a time the reminder has moved on from. */
  setAside: Partial<ReminderFields>
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
    ...(r.recurring ? { recurring: true } : {}),
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

/**
 * A task's due day and time on the phone's clock. A task with a time is at an instant (its time in its own zone): made
 * for someone in another time zone, it is at that moment on their iPhone too. A day without a time is that day anywhere.
 */
export function dueOnPhone(t: Pick<Task, 'dueDate' | 'dueTime' | 'timezone'>, zone: string | undefined): Pick<ReminderFields, 'dueDate' | 'dueTime'> {
  if (!t.dueDate) return { dueDate: null, dueTime: null }
  if (!t.dueTime || !zone || !t.timezone || t.timezone === zone) return { dueDate: t.dueDate, dueTime: t.dueTime }
  const f = fieldsInZone(zonedMs(t.dueDate, t.dueTime, t.timezone), zone)
  return { dueDate: makeKey(f.y, f.m, f.d), dueTime: formatHHmm(f.h, f.min) }
}

function taskFields(t: Task, deviceListOf: (listId: string) => string | null, zone?: string): ReminderFields {
  return {
    title: t.title,
    notes: t.notes ?? '',
    ...dueOnPhone(t, zone),
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
 *
 * A repeating reminder is one task at its next time (GOOYA does not model Reminders' repeat), and Reminders never keeps
 * it done: marked done, it gets a done copy of that time and moves on to its next date, not done. So GOOYA's done mark
 * on it is for the time at the task's date, and goes to the reminder once, while the reminder is still at that time.
 *
 * With `categoryTargets` (the phone's list for each category, from planCategoryLists), a task in a category is a
 * reminder in that list; without, a task in one of GOOYA's own lists leaves Reminders (builds before categories).
 * `zone` is the phone's: a task with a time made in another zone is at the same moment on the phone's clock.
 */
export function planReminderSync(
  device: DeviceReminder[],
  tasks: Task[],
  baseline: Record<string, ReminderFields>,
  owner: string,
  lists: TaskList[] = [],
  links: Record<string, string> = {},
  writableLists?: Set<string>,
  opts: { categoryTargets?: Record<string, string>; zone?: string } = {},
): ReminderPlan {
  const listById = new Map(lists.map((l) => [l.id, l]))
  const targets = opts.categoryTargets
  const deviceListOf = (listId: string): string | null => {
    const l = listById.get(listId)
    if (l && isReminderList(l) && l.owner === owner && l.externalId) return l.externalId
    return targets && l && isCategory(l) ? (targets[l.id] ?? null) : null
  }
  /** What a task's list asks of its reminder: a Reminders list to be in, to leave Reminders, or nothing said. */
  const intentOf = (t: Task): { kind: 'list'; listId: string } | { kind: 'leave' } | { kind: 'none' } => {
    const device = deviceListOf(t.listId)
    if (device) return { kind: 'list', listId: device }
    // A category with no list on this phone (it could not be made): the reminder stays where it is.
    if (targets) return { kind: 'none' }
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

  const plan: ReminderPlan = { reminders: [], changes: [], creates: [], deletes: [], unlink: [], seen: {} }
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
    const gooya = taskFields(task, deviceListOf, opts.zone)
    const change: ReminderChange = { id: r.id }
    const next = { ...r }
    // GOOYA's values for what goes to the reminder, and for what is left out on purpose (sentBase). Not the list: the
    // server compares the task's own list (a category, after a move in GOOYA) with a Reminders list, never equal.
    const taken: Partial<ReminderFields> = {}
    const setAside: Partial<ReminderFields> = {}
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
    // A repeating reminder GOOYA has done and Reminders has not. The mark goes to the reminder only while the reminder
    // is at the time it was for, the one both last agreed on. Otherwise it was for a time the reminder has moved on from
    // (done in Reminders too, moved there, or a copy of GOOYA that still shows a mark this phone took there already):
    // the mark and that date are set aside and the task follows the reminder. Sent again, each sync would complete the
    // next time, and the next, until the repeat ends.
    const doneMark = !!r.recurring && gooya.completed && !phone.completed
    if (doneMark) {
      if (!base.completed && sameDue(gooya, phone) && sameDue(phone, base)) {
        change.completed = true
        next.completed = true
        taken.completed = true
      } else Object.assign(setAside, { completed: true, dueDate: gooya.dueDate, dueTime: gooya.dueTime })
    } else if (gooya.completed !== base.completed && phone.completed === base.completed) {
      change.completed = gooya.completed
      next.completed = gooya.completed
      taken.completed = gooya.completed
    }
    if (gooya.title.trim() && gooya.title !== base.title && phone.title === base.title) {
      change.title = gooya.title
      next.title = gooya.title
      taken.title = gooya.title
    }
    if (gooya.notes !== base.notes && phone.notes === base.notes) {
      // GOOYA shows the reminder's link under its notes; the link stays the reminder's own.
      const notes = r.url && gooya.notes.endsWith(r.url) ? gooya.notes.slice(0, -r.url.length).replace(/\n$/, '') : gooya.notes
      change.notes = notes
      next.notes = notes
      taken.notes = gooya.notes
    }
    if (!doneMark && gooya.dueDate && !sameDue(gooya, base) && sameDue(phone, base)) {
      change.dueDate = gooya.dueDate
      change.dueTime = gooya.dueTime
      next.dueDate = gooya.dueDate
      next.dueTime = gooya.dueTime
      Object.assign(taken, { dueDate: gooya.dueDate, dueTime: gooya.dueTime })
    }
    if (gooya.priority !== base.priority && phone.priority === base.priority) {
      change.priority = applePriority(gooya.priority)
      next.priority = change.priority
      taken.priority = gooya.priority
    }
    if (Object.keys(change).length > 1) plan.changes.push(change)
    if (Object.keys(taken).length || Object.keys(setAside).length) plan.seen[r.id] = { taken, setAside }
    plan.reminders.push(next)
  }
  // GOOYA's own tasks put in one of this person's Reminders lists (or in a category) become reminders there. One that
  // repeats stays GOOYA's (Reminders would get a single reminder: its repeat is GOOYA's to keep), and so does one
  // already done when it was put in a category.
  for (const t of mine) {
    if (reminderIdOf(t) || (links[t.id] && deviceIds.has(links[t.id]))) continue
    const intent = intentOf(t)
    if (intent.kind !== 'list' || !canWrite(intent.listId)) continue
    if (isCategory(listById.get(t.listId)) && (t.completed || t.rrule)) continue
    plan.creates.push({ taskId: t.id, listId: intent.listId, title: t.title, notes: t.notes ?? '', ...dueOnPhone(t, opts.zone), completed: !!t.completed, priority: applePriority(t.priority ?? 0) })
  }
  return plan
}

/** What GOOYA and the iPhone agree on after a sync: the next sync's baseline. */
export function baselineOf(reminders: DeviceReminder[]): Record<string, ReminderFields> {
  return Object.fromEntries(reminders.map((r) => [r.id, reminderFields(r)]))
}

/**
 * The `base` the iPhone sends with a reminder: what it and GOOYA last agreed on, with GOOYA's own values for the fields
 * the sync took into account (`seen`; those taken to the reminder only when the change was `made` there). The server
 * keeps a GOOYA value only when GOOYA changed it after the phone looked, so what Reminders made of a change it was given
 * comes back to GOOYA as it is. With the agreed values alone, a repeating reminder marked done from GOOYA (back at its
 * next date, not done) looked unchanged on the phone: the server kept GOOYA's done mark, and the phone sent it again.
 */
export function sentBase(base: ReminderFields | undefined, seen: GooyaSide | undefined, made = true): ReminderFields | undefined {
  if (!base || !seen) return base
  return { ...base, ...seen.setAside, ...(made ? seen.taken : {}) }
}

// ---------------------------------------------------------------- categories as Reminders lists (the iPhone)

/** Colours the same to the eye: Reminders gives back a colour set through EventKit off by a step at most. */
export function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  const rgb = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null)
  const x = rgb(a)
  const y = rgb(b)
  return !!x && !!y && x.every((v, i) => Math.abs(v - y[i]) <= 3)
}

export interface CategoryListsPlan {
  /** Category id → this phone's list for it (lists still to be made are added once made). */
  targets: Record<string, string>
  /** Categories that need a list made on this phone, in their name and colour. */
  create: { categoryId: string; title: string; color: string }[]
  /** Lists this phone finds for a category by name (in no category yet): the server links them. */
  link: { listId: string; categoryId: string }[]
  /** A category's name or colour to give its list here. */
  update: { listId: string; title?: string; color?: string }[]
  /** A list renamed or recoloured in Reminders: its category takes it. */
  report: { listId: string; name?: string; color?: string }[]
}

/**
 * The phone's Reminders lists as GOOYA's categories, for one person (`owner`). Every category their tasks are in (not a
 * done or repeating task that never was a reminder) gets a list here: the one that stands for it, one of the same name in no category
 * yet, or a new one. A list that stands for a category has its name and colour: what changed since `baseline` (what
 * both last agreed on) wins, a change in Reminders over one in GOOYA; with no baseline GOOYA's is taken.
 */
export function planCategoryLists(owner: string, device: DeviceList[], tasks: Task[], lists: TaskList[], baseline: Record<string, ListFields>): CategoryListsPlan {
  const byId = new Map(lists.map((l) => [l.id, l]))
  const plan: CategoryListsPlan = { targets: {}, create: [], link: [], update: [], report: [] }
  /** Device list → its category, as GOOYA has it (or as linked now). */
  const linked = new Map<string, string>()
  for (const l of lists) {
    if (!isReminderList(l) || l.owner !== owner || !l.externalId || !l.categoryId) continue
    if (isCategory(byId.get(l.categoryId)) && device.some((d) => d.id === l.externalId)) linked.set(l.externalId, l.categoryId)
  }
  const needed: string[] = []
  for (const t of tasks) {
    if (t.owner !== owner) continue
    const l = byId.get(t.listId)
    if (!l || !isCategory(l) || needed.includes(l.id)) continue
    if ((t.completed || t.rrule) && !reminderIdOf(t)) continue
    needed.push(l.id)
  }
  for (const id of needed) {
    const category = byId.get(id)!
    const own = device.find((d) => linked.get(d.id) === id && d.writable)
    if (own) {
      plan.targets[id] = own.id
      continue
    }
    const named = device.find((d) => d.writable && !linked.has(d.id) && categoryKey(d.title) === categoryKey(category.name))
    if (named) {
      plan.targets[id] = named.id
      plan.link.push({ listId: named.id, categoryId: id })
      linked.set(named.id, id)
      continue
    }
    plan.create.push({ categoryId: id, title: category.name, color: category.color })
  }
  for (const d of device) {
    const id = linked.get(d.id)
    const category = id ? byId.get(id) : undefined
    if (!category) continue
    const base = baseline[d.id]
    const update: { title?: string; color?: string } = {}
    const report: { name?: string; color?: string } = {}
    if (d.title !== category.name) {
      if (base && d.title !== base.title) report.name = d.title
      else update.title = category.name
    }
    if (!sameColor(d.color, category.color)) {
      if (base && !sameColor(d.color, base.color)) report.color = d.color
      else update.color = category.color
    }
    if ((update.title || update.color) && d.editable !== false) plan.update.push({ listId: d.id, ...update })
    if (report.name || report.color) plan.report.push({ listId: d.id, ...report })
  }
  return plan
}

/**
 * The server's side of the merge. `current` is the task as GOOYA has it now, `incoming` the reminder's fields as the
 * phone sends them, `base` what the phone last agreed on with GOOYA. A field GOOYA changed after the phone's copy of
 * GOOYA was taken (someone else changed it just now), and the phone did not, stays GOOYA's: the phone takes it to the
 * reminder next time. Returns the fields to write and the names of the fields kept.
 *
 * A repeating reminder at another time than `base` has moved on (marked done, in Reminders or by the phone, or re-dated
 * there): a done mark GOOYA has was for the time before, so the reminder's own stays. Kept, the phone would take it to
 * the reminder's next time.
 */
export function mergeIntoTask(
  current: Pick<Task, 'title' | 'notes' | 'dueDate' | 'dueTime' | 'completed' | 'priority' | 'listId'>,
  incoming: Omit<ReminderFields, 'listId'> & { gooyaListId: string; recurring?: boolean },
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
  const movedOn = !!incoming.recurring && !!base && !sameDue({ dueDate: incoming.dueDate, dueTime: incoming.dueDate ? incoming.dueTime : null }, { dueDate: base.dueDate, dueTime: base.dueDate ? base.dueTime : null })
  return {
    fields: {
      title: pick('title', current.title, incoming.title, base?.title),
      notes: pick('notes', current.notes ?? '', incoming.notes, base?.notes),
      dueDate: due.dueDate,
      dueTime: due.dueTime,
      completed: movedOn ? incoming.completed : pick('completed', !!current.completed, incoming.completed, base?.completed),
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
  /** Categories to write: made from a Reminders list of a name GOOYA had none of, or renamed or recoloured there. */
  categories: TaskList[]
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
  const out: ImportOutcome = { tasks: [], deleteTasks: [], lists: [], categories: [], deleteLists: [], kept: 0, created: 0, updated: 0, removed: 0, unlinked: 0 }
  const withLists = Array.isArray(payload.lists)
  const deviceLists = (payload.lists ?? []).filter((l) => l && typeof l.id === 'string' && l.id)
  const listIdOf = new Map(deviceLists.map((l) => [l.id, reminderListDocId(person, l.id, (s) => hash(s, 16))]))
  // Each Reminders list stands for a category: the one it stood for, one of its name, or one made from it.
  const categories = lists.filter((l) => isCategory(l))
  const made: TaskList[] = []
  const changed = new Map<string, TaskList>()
  const known = () => [...categories, ...made]
  const byName = (name: string) => known().find((c) => categoryKey(c.name) === categoryKey(name))
  const exists = (id: string) => known().some((c) => c.id === id)
  const lastOrder = Math.max(0, ...categories.map((c) => c.order))
  const categoryFor = (l: DeviceList, prev: TaskList | undefined, name: string, color: string): string => {
    if (typeof l.categoryId === 'string' && l.categoryId && exists(l.categoryId)) return l.categoryId
    if (prev?.categoryId && exists(prev.categoryId)) return prev.categoryId
    // Its category was deleted in GOOYA: it stands for one again only when one of its name is made.
    if (prev?.categoryId === '') return byName(name)?.id ?? ''
    const found = byName(name)
    if (found) return found.id
    const id = `c_${hash(`category:${categoryKey(name)}`, 16)}`
    // Made from this name before and renamed since: still that one.
    if (lists.some((x) => x.id === id && isCategory(x))) return id
    made.push({ id, name, color, icon: 'list', order: lastOrder + 1 + made.length, createdBy: person as TaskList['createdBy'], createdAt: now, updatedAt: now })
    return id
  }
  if (withLists) {
    deviceLists.forEach((l, i) => {
      const id = listIdOf.get(l.id)!
      const prev = lists.find((x) => x.id === id)
      const name = String(l.title || 'Reminders').slice(0, 100)
      const color = HEX_COLOR.test(l.color) ? l.color.toLowerCase() : '#ff9500'
      const categoryId = categoryFor(l, prev, name, color)
      const next: TaskList = {
        id,
        name,
        color,
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
        categoryId,
      }
      const same = prev && prev.name === next.name && prev.color === next.color && prev.order === next.order && prev.source === next.source && prev.owner === next.owner && prev.externalId === next.externalId && !!prev.readOnly === next.readOnly && !!prev.isDefault === next.isDefault && prev.categoryId === next.categoryId
      if (!same) out.lists.push(next)
      // Renamed or recoloured in Reminders: so is the category (and so the other person's list for it, by their iPhone).
      const category = categoryId ? categories.find((c) => c.id === categoryId) : undefined
      if (category && (l.categoryName || l.categoryColor)) {
        const was = changed.get(category.id) ?? category
        changed.set(category.id, {
          ...was,
          ...(l.categoryName && l.categoryName.trim() ? { name: l.categoryName.trim().slice(0, 100) } : {}),
          ...(l.categoryColor && HEX_COLOR.test(l.categoryColor) ? { color: l.categoryColor.toLowerCase() } : {}),
          updatedAt: now,
        })
      }
    })
    out.categories = [...made, ...changed.values()]
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
      recurring: r.recurring === true,
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
        fields: { ...fields, createdBy: person as Task['createdBy'], rrule: null, exdates: [], overrides: {}, completedDates: [], earlyReminders: [], tags: [], flagged: false, private: false, createdAt: now, updatedAt: now },
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
