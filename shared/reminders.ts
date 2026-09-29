// Apple Reminders ⇄ GOOYA, the part that needs no phone: how a reminder becomes a GOOYA task, and which side of a
// change wins. The iPhone app reads Reminders with EventKit (src/lib/reminders.ts) and sends them to the server's
// remindersImport (functions/src/integrations/reminders.ts), which applies the same rules as reminderFields below.

import type { DateKey, HHmm, Task } from './model'

export const REMINDERS_SOURCE = 'apple-reminders'
export const REMINDERS_LIST_ID = 'apple-reminders'

/** A reminder as the iPhone has it (EventKit), in plain values. */
export interface DeviceReminder {
  id: string
  title: string
  notes: string
  url: string
  /** Where the reminder is (EventKit clears it unless it is passed back when saving). */
  location: string
  /** The due day and time on the phone's clock; the time is null for a reminder with a date only. */
  dueDate: DateKey | null
  dueTime: HHmm | null
  completed: boolean
  /** The Reminders list's name ("Groceries"), which GOOYA keeps as a tag. */
  list: string
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
}

/** The GOOYA task fields a reminder becomes, and what a change to them is compared with. */
export interface ReminderFields {
  title: string
  notes: string
  dueDate: DateKey | null
  dueTime: HHmm | null
  completed: boolean
}

/** A change made in GOOYA that goes back to the reminder on the iPhone. */
export interface ReminderChange {
  id: string
  title?: string
  notes?: string
  dueDate?: DateKey
  dueTime?: HHmm | null
  completed?: boolean
}

export function reminderFields(r: Pick<DeviceReminder, 'title' | 'notes' | 'url' | 'dueDate' | 'dueTime' | 'completed'>): ReminderFields {
  return {
    title: r.title.slice(0, 500),
    notes: [r.notes, r.url].filter(Boolean).join('\n'),
    dueDate: r.dueDate,
    dueTime: r.dueDate ? r.dueTime : null,
    completed: r.completed,
  }
}

export function toImport(r: DeviceReminder): ReminderImport {
  return {
    id: r.id,
    title: r.title,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.url ? { url: r.url } : {}),
    dueDate: r.dueDate,
    dueTime: r.dueDate ? r.dueTime : null,
    completed: r.completed,
    list: r.list,
  }
}

/** The reminder id a GOOYA task came from, or null for GOOYA's own tasks. */
export function reminderIdOf(task: Pick<Task, 'source' | 'externalRefs'>): string | null {
  if (task.source !== REMINDERS_SOURCE) return null
  return task.externalRefs?.find((r) => r.source === REMINDERS_SOURCE)?.externalId ?? null
}

function taskFields(t: Task): ReminderFields {
  return { title: t.title, notes: t.notes ?? '', dueDate: t.dueDate, dueTime: t.dueDate ? t.dueTime : null, completed: !!t.completed }
}

const sameDue = (a: ReminderFields, b: ReminderFields) => a.dueDate === b.dueDate && a.dueTime === b.dueTime

/**
 * A three-way merge per reminder: what the iPhone has, what GOOYA has, and what they last agreed on (`baseline`, kept
 * on the phone). A field GOOYA changed since then, and the iPhone did not, goes back to the reminder; everything else
 * comes from the iPhone. Without a baseline (the first sync, or a new reminder) the iPhone wins.
 *
 * Returns the reminders as they will be after the changes (what to send to GOOYA) and the changes to save on the
 * phone. A date cleared in GOOYA is not cleared in Reminders (EventKit through Expo cannot clear one).
 */
export function planReminderSync(device: DeviceReminder[], tasks: Task[], baseline: Record<string, ReminderFields>, owner: string): { reminders: DeviceReminder[]; changes: ReminderChange[] } {
  const byId = new Map<string, Task>()
  for (const t of tasks) {
    if (t.owner !== owner) continue
    const id = reminderIdOf(t)
    if (id) byId.set(id, t)
  }
  const changes: ReminderChange[] = []
  const reminders = device.map((r) => {
    const task = byId.get(r.id)
    const base = baseline[r.id]
    if (!task || !base) return r
    const phone = reminderFields(r)
    const gooya = taskFields(task)
    const change: ReminderChange = { id: r.id }
    const next = { ...r }
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
    if (Object.keys(change).length > 1) changes.push(change)
    return next
  })
  return { reminders, changes }
}

/** What GOOYA and the iPhone agree on after a sync: the next sync's baseline. */
export function baselineOf(reminders: DeviceReminder[]): Record<string, ReminderFields> {
  return Object.fromEntries(reminders.map((r) => [r.id, reminderFields(r)]))
}
