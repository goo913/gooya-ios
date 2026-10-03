import type { DateKey, HHmm, Priority, Task, TaskOccurrence, TaskOverride } from '@shared/model'
import type { PersonKey } from '@shared/people'
import { withUntil } from '@shared/recurrence'
import { isReminderList, reminderIdOf } from '@shared/reminders'
import { addDaysKey } from '@shared/time'
import { useData } from '@/store/data'
import { deleteTask, newId, patchTask, saveTask } from './db'
import { deleteReminderOf, syncRemindersSoon } from './reminders'

export type EditScope = 'this' | 'future'

/** Everything a person can edit on a task (reminder). */
export interface TaskFields {
  owner: PersonKey
  listId: string
  title: string
  notes: string
  dueDate: DateKey | null
  dueTime: HHmm | null
  timezone: string
  rrule: string | null
  earlyReminders: number[]
  tags: string[]
  flagged: boolean
  priority: Priority
  /** Only its owner sees it (Share off). Always written, so the other person's query can ask for shared ones. */
  private: boolean
}

export function makeTask(fields: TaskFields, createdBy: PersonKey): Task {
  const now = Date.now()
  return {
    id: newId(),
    createdBy,
    ...fields,
    exdates: [],
    overrides: {},
    completed: false,
    completedDates: [],
    source: 'gooya',
    externalRefs: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Whether a change to this task has to reach Apple Reminders: it is one of its owner's reminders, it is in (or moves to
 * or from) one of their Reminders lists, or its owner syncs Reminders (every category is a list there). The owner's
 * iPhone takes it there (src/lib/reminders.ts).
 */
function touchesReminders(task: Pick<Task, 'source' | 'externalRefs' | 'listId' | 'owner'>, fields?: Pick<TaskFields, 'listId' | 'owner'>): boolean {
  if (reminderIdOf(task)) return true
  const lists = useData.getState().lists
  const owners = [task.owner, fields?.owner]
  if (lists.some((l) => isReminderList(l) && owners.includes(l.owner))) return true
  return [task.listId, fields?.listId].some((id) => id && isReminderList(lists.find((l) => l.id === id)))
}

export async function createTask(fields: TaskFields, createdBy: PersonKey): Promise<Task> {
  const task = makeTask(fields, createdBy)
  await saveTask(task)
  if (touchesReminders(task)) syncRemindersSoon()
  return task
}

/** Toggle completion for one occurrence (or the whole task when not repeating). */
export async function setCompleted(task: Task, dateKey: DateKey | null, completed: boolean): Promise<void> {
  if (!task.rrule || !dateKey) {
    await patchTask(task.id, { completed })
    if (touchesReminders(task)) syncRemindersSoon()
    return
  }
  const set = new Set(task.completedDates ?? [])
  if (completed) set.add(dateKey)
  else set.delete(dateKey)
  await patchTask(task.id, { completedDates: Array.from(set).sort() })
}

/** Done, or not done again: a task's ring clicked (this occurrence of a repeating one). */
export function toggleCompleted(occ: TaskOccurrence): Promise<void> {
  return setCompleted(occ.task, occ.dateKey, !occ.completed)
}

/** Apply edited fields with Apple's "this only / future" semantics. */
export async function applyTaskEdit(task: Task, occ: TaskOccurrence | null, fields: TaskFields, scope: EditScope): Promise<void> {
  // A reminder given to the other person is no longer its owner's reminder: it becomes a GOOYA task (the owner's
  // iPhone then takes it out of their Reminders; it becomes one of the new owner's reminders if it is in their list).
  if (reminderIdOf(task) && fields.owner !== task.owner) await patchTask(task.id, { source: 'gooya', externalRefs: [] })
  await applyEdit(task, occ, fields, scope)
  if (touchesReminders(task, fields)) syncRemindersSoon()
}

async function applyEdit(task: Task, occ: TaskOccurrence | null, fields: TaskFields, scope: EditScope): Promise<void> {
  if (!task.rrule || !occ) {
    await patchTask(task.id, { ...fields })
    return
  }
  if (scope === 'this') {
    const ov: TaskOverride = { title: fields.title, notes: fields.notes, dueDate: fields.dueDate ?? occ.dueDate, dueTime: fields.dueTime }
    await patchTask(task.id, {
      overrides: { ...(task.overrides ?? {}), [occ.dateKey]: ov },
      // list/tags/flag/priority are properties of the series
      listId: fields.listId,
      tags: fields.tags,
      flagged: fields.flagged,
      priority: fields.priority,
    })
    return
  }
  if (!task.dueDate || occ.dateKey <= task.dueDate) {
    await patchTask(task.id, { ...fields, overrides: {}, exdates: [], completedDates: [] })
    return
  }
  await splitSeries(task, occ.dateKey, fields)
}

async function splitSeries(task: Task, fromKey: DateKey, fields: TaskFields): Promise<void> {
  const last = addDaysKey(fromKey, -1)
  const keep = (arr: string[] | undefined, before: boolean) => (arr ?? []).filter((k) => (before ? k < fromKey : k > fromKey))
  await patchTask(task.id, {
    rrule: withUntil(task.rrule ?? 'FREQ=DAILY', last),
    exdates: keep(task.exdates, true),
    completedDates: keep(task.completedDates, true),
    overrides: Object.fromEntries(Object.entries(task.overrides ?? {}).filter(([k]) => k < fromKey)),
  })
  const now = Date.now()
  await saveTask({
    id: newId(),
    createdBy: task.createdBy,
    ...fields,
    dueDate: fields.dueDate ?? fromKey,
    exdates: keep(task.exdates, false),
    overrides: Object.fromEntries(Object.entries(task.overrides ?? {}).filter(([k]) => k > fromKey)),
    completed: false,
    completedDates: keep(task.completedDates, false),
    source: task.source,
    externalRefs: [],
    createdAt: now,
    updatedAt: now,
  })
}

/** Delete an occurrence, the future, or the whole task. */
export async function deleteTaskScope(task: Task, occ: TaskOccurrence | null, scope: EditScope | 'all'): Promise<boolean> {
  const whole = !task.rrule || scope === 'all' || !occ || (scope === 'future' && (!task.dueDate || occ.dateKey <= task.dueDate))
  if (whole && touchesReminders(task)) {
    // One of someone's Apple Reminders: deleting it here deletes the reminder, as Apple Calendar's "Delete Reminder"
    // does: right away on its owner's iPhone, otherwise by their iPhone the next time GOOYA runs there.
    await deleteReminderOf(task)
    await deleteTask(task.id)
    return true
  }
  if (!task.rrule || scope === 'all' || !occ) {
    await deleteTask(task.id)
    return true
  }
  if (scope === 'this') {
    const exdates = Array.from(new Set([...(task.exdates ?? []), occ.dateKey]))
    const overrides = { ...(task.overrides ?? {}) }
    delete overrides[occ.dateKey]
    await patchTask(task.id, { exdates, overrides })
    return true
  }
  if (!task.dueDate || occ.dateKey <= task.dueDate) {
    await deleteTask(task.id)
    return true
  }
  const last = addDaysKey(occ.dateKey, -1)
  await patchTask(task.id, {
    rrule: withUntil(task.rrule, last),
    exdates: (task.exdates ?? []).filter((k) => k <= last),
    completedDates: (task.completedDates ?? []).filter((k) => k <= last),
    overrides: Object.fromEntries(Object.entries(task.overrides ?? {}).filter(([k]) => k <= last)),
  })
  return true
}

export function fieldsOf(task: Task): TaskFields {
  return {
    owner: task.owner,
    listId: task.listId,
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    timezone: task.timezone,
    rrule: task.rrule,
    earlyReminders: task.earlyReminders ?? [],
    tags: task.tags ?? [],
    flagged: !!task.flagged,
    priority: task.priority ?? 0,
    private: !!task.private,
  }
}
