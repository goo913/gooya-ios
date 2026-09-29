import type { DateKey, HHmm, Priority, Task, TaskOccurrence, TaskOverride } from '@shared/model'
import type { PersonKey } from '@shared/people'
import { withUntil } from '@shared/recurrence'
import { reminderIdOf } from '@shared/reminders'
import { addDaysKey } from '@shared/time'
import { Alert } from 'react-native'
import { deleteTask, newId, patchTask, saveTask } from './db'
import { deleteReminderOf, reminderOwnerName, syncRemindersSoon } from './reminders'

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

export async function createTask(fields: TaskFields, createdBy: PersonKey): Promise<Task> {
  const task = makeTask(fields, createdBy)
  await saveTask(task)
  return task
}

/** Toggle completion for one occurrence (or the whole task when not repeating). */
export async function setCompleted(task: Task, dateKey: DateKey | null, completed: boolean): Promise<void> {
  if (!task.rrule || !dateKey) {
    await patchTask(task.id, { completed })
    // A task from Apple Reminders: complete the reminder too (on its owner's iPhone).
    if (reminderIdOf(task)) syncRemindersSoon()
    return
  }
  const set = new Set(task.completedDates ?? [])
  if (completed) set.add(dateKey)
  else set.delete(dateKey)
  await patchTask(task.id, { completedDates: Array.from(set).sort() })
}

/** Apply edited fields with Apple's "this only / future" semantics. */
export async function applyTaskEdit(task: Task, occ: TaskOccurrence | null, fields: TaskFields, scope: EditScope): Promise<void> {
  await applyEdit(task, occ, fields, scope)
  if (reminderIdOf(task)) syncRemindersSoon()
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

/** Delete an occurrence, the future, or the whole task. False when it was not deleted (someone else's reminder). */
export async function deleteTaskScope(task: Task, occ: TaskOccurrence | null, scope: EditScope | 'all'): Promise<boolean> {
  if (reminderIdOf(task)) {
    // From Apple Reminders: deleting it here deletes the reminder, as Apple Calendar's "Delete Reminder" does. The
    // other person's reminders can only be deleted on their iPhone (here they would just come back).
    const result = await deleteReminderOf(task)
    if (result === 'not-mine') {
      const name = reminderOwnerName(task) ?? 'the other person'
      Alert.alert('From Apple Reminders', `This comes from ${name}’s Apple Reminders, so it can be deleted only in Reminders on ${name}’s iPhone. You can complete it here.`)
      return false
    }
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
  }
}

/** Fields for a drag move: new due date/time (viewer-local wall clock) and owner. */
export function movedFields(task: Task, occ: TaskOccurrence, dueDate: DateKey, dueTime: HHmm | null, owner: PersonKey, viewerTz: string): TaskFields {
  return { ...fieldsOf(task), title: occ.title, notes: occ.notes, owner, dueDate, dueTime, timezone: dueTime ? viewerTz : task.timezone || viewerTz }
}
