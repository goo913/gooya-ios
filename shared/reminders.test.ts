import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { Task, TaskList } from './model'
import { applePriority, applyReminderImport, baselineOf, dueOnPhone, gooyaPriority, mergeIntoTask, planCategoryLists, planReminderSync, reminderFields, sameColor, toImport, type DeviceList, type DeviceReminder } from './reminders'

function reminder(extra: Partial<DeviceReminder> = {}): DeviceReminder {
  return { id: 'r1', title: 'Pick up package', notes: '', url: '', dueDate: '2026-09-29', dueTime: '15:00', completed: false, list: 'Errands', listId: 'L1', priority: 0, ...extra }
}

const list = (id: string, extra: Partial<TaskList> = {}): TaskList => ({ id, name: id, color: '#ff9500', icon: 'list', order: 100, createdBy: 'gooya', createdAt: 0, updatedAt: 0, ...extra })
/** gooya's two Reminders lists (Errands = L1, School = L2) and GOOYA's own "Tasks" list. */
const LISTS = [
  list('rl_errands', { name: 'Errands', source: 'apple-reminders', owner: 'gooya', externalId: 'L1' }),
  list('rl_school', { name: 'School', source: 'apple-reminders', owner: 'gooya', externalId: 'L2' }),
  list('rl_eunbi', { name: 'Eunbi', source: 'apple-reminders', owner: 'eunbi', externalId: 'E1' }),
  list('tasks', { name: 'Tasks' }),
]

/** The task the server made from a reminder, then possibly changed in GOOYA. */
function taskFrom(r: DeviceReminder, extra: Partial<Task> = {}): Task {
  const f = reminderFields(r)
  return {
    id: 'ar_1', owner: 'gooya', createdBy: 'gooya', listId: 'rl_errands', title: f.title, notes: f.notes, dueDate: f.dueDate, dueTime: f.dueTime,
    timezone: 'America/New_York', rrule: null, exdates: [], overrides: {}, completed: f.completed, completedDates: [], earlyReminders: [], tags: [],
    flagged: false, priority: f.priority, source: 'apple-reminders', externalRefs: [{ source: 'apple-reminders', accountId: 'gooya', calendarId: 'L1', externalId: r.id, updatedAt: 0 }],
    createdAt: 0, updatedAt: 0, ...extra,
  } as Task
}

const gooyaTask = (extra: Partial<Task> = {}): Task =>
  ({ ...taskFrom(reminder()), id: 't9', title: 'Buy stamps', source: 'gooya', externalRefs: [], dueTime: '10:00', ...extra }) as Task

test('the first sync takes everything from the iPhone', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { completed: true, title: 'Other' })], {}, 'gooya', LISTS)
  assert.deepEqual(plan.changes, [])
  assert.deepEqual(plan.reminders, [r])
})

test('completing in GOOYA completes the reminder', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { completed: true })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [{ id: 'r1', completed: true }])
  assert.equal(plan.reminders[0].completed, true)
})

test('completing in Reminders wins when GOOYA did not change', () => {
  const r = reminder()
  const plan = planReminderSync([{ ...r, completed: true }], [taskFrom(r)], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.reminders[0].completed, true)
})

test('a change on both sides keeps the iPhone’s', () => {
  const r = reminder()
  const plan = planReminderSync([{ ...r, title: 'Pick up the parcel' }], [taskFrom(r, { title: 'Get package' })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.reminders[0].title, 'Pick up the parcel')
})

test('renaming and re-dating in GOOYA go back to the reminder (5 PM → 10 AM)', () => {
  const r = reminder({ dueTime: '17:00' })
  const plan = planReminderSync([r], [taskFrom(r, { title: 'Pick up package at 4', dueTime: '10:00' })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [{ id: 'r1', title: 'Pick up package at 4', dueDate: '2026-09-29', dueTime: '10:00' }])
  assert.equal(plan.reminders[0].dueTime, '10:00')
})

test('a date cleared in GOOYA is not sent (Reminders keeps it)', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { dueDate: null, dueTime: null })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.reminders[0].dueDate, '2026-09-29')
})

test('notes edited in GOOYA go back without the reminder’s link', () => {
  const r = reminder({ notes: 'Front desk', url: 'https://ups.example/123' })
  const plan = planReminderSync([r], [taskFrom(r, { notes: 'Back door\nhttps://ups.example/123' })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [{ id: 'r1', notes: 'Back door' }])
})

test('priority both ways', () => {
  assert.equal(gooyaPriority(1), 3)
  assert.equal(gooyaPriority(5), 2)
  assert.equal(gooyaPriority(9), 1)
  assert.equal(applePriority(3), 1)
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { priority: 3 })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [{ id: 'r1', priority: 1 }])
})

test('the other person’s tasks never change my reminders', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { owner: 'eunbi', completed: true })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [])
})

test('moving a task to another of my Reminders lists moves the reminder', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { listId: 'rl_school' })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.changes, [{ id: 'r1', listId: 'L2' }])
  assert.equal(plan.reminders[0].listId, 'L2')
  assert.equal(plan.reminders[0].list, 'School')
})

test('a task still in the old single "Apple Reminders" list stays where Reminders has it', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { listId: 'apple-reminders' })], baselineOf([r]), 'gooya', [...LISTS, list('apple-reminders')])
  assert.deepEqual(plan.changes, [])
  assert.deepEqual(plan.unlink, [])
  assert.deepEqual(plan.deletes, [])
})

test('moving a task to one of GOOYA’s own lists takes it out of Reminders', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { listId: 'tasks' })], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(plan.unlink, [{ taskId: 'ar_1', reminderId: 'r1' }])
  assert.deepEqual(plan.reminders, [])
})

test('a task deleted in GOOYA deletes its reminder, unless the reminder changed on the phone meanwhile', () => {
  const r = reminder()
  assert.deepEqual(planReminderSync([r], [], baselineOf([r]), 'gooya', LISTS).deletes, ['r1'])
  const changed = planReminderSync([{ ...r, title: 'Changed on the phone' }], [], baselineOf([r]), 'gooya', LISTS)
  assert.deepEqual(changed.deletes, [])
  assert.equal(changed.reminders.length, 1)
  // Never seen before: a new reminder, not a deleted task.
  assert.deepEqual(planReminderSync([r], [], {}, 'gooya', LISTS).deletes, [])
})

test('a task made in GOOYA in one of my Reminders lists becomes a reminder there', () => {
  const plan = planReminderSync([], [gooyaTask({ listId: 'rl_school', priority: 2 })], {}, 'gooya', LISTS)
  assert.deepEqual(plan.creates, [{ taskId: 't9', listId: 'L2', title: 'Buy stamps', notes: '', dueDate: '2026-09-29', dueTime: '10:00', completed: false, priority: 5 }])
  // In GOOYA's own list, or in someone else's Reminders list: it stays in GOOYA.
  assert.deepEqual(planReminderSync([], [gooyaTask({ listId: 'tasks' })], {}, 'gooya', LISTS).creates, [])
  assert.deepEqual(planReminderSync([], [gooyaTask({ listId: 'rl_eunbi' })], {}, 'gooya', LISTS).creates, [])
})

test('a reminder made for a task is not made twice while GOOYA has not heard of it', () => {
  const made = reminder({ id: 'new1', title: 'Buy stamps', listId: 'L2' })
  const plan = planReminderSync([made], [gooyaTask({ listId: 'rl_school' })], {}, 'gooya', LISTS, { t9: 'new1' })
  assert.deepEqual(plan.creates, [])
  assert.deepEqual(plan.reminders, [made])
})

test('read-only lists are never written', () => {
  const r = reminder()
  const plan = planReminderSync([r], [taskFrom(r, { completed: true })], baselineOf([r]), 'gooya', LISTS, {}, new Set(['L2']))
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.reminders[0].completed, false)
  assert.deepEqual(planReminderSync([r], [], baselineOf([r]), 'gooya', LISTS, {}, new Set(['L2'])).deletes, [])
})

test('what the server receives', () => {
  assert.deepEqual(toImport(reminder({ notes: 'n', url: 'https://x.example', dueTime: null })), {
    id: 'r1', title: 'Pick up package', notes: 'n', url: 'https://x.example', dueDate: '2026-09-29', dueTime: null, completed: false, list: 'Errands', listId: 'L1', priority: 0,
  })
  assert.deepEqual(toImport(reminder({ dueDate: null, dueTime: '15:00' })).dueTime, null)
})

test('the server keeps a change GOOYA made after the phone looked', () => {
  const base = { title: 'A', notes: '', dueDate: '2026-09-29', dueTime: '17:00', completed: false, priority: 0 as const, gooyaListId: 'rl_errands' }
  // Someone moved it to 10:00 in GOOYA a moment ago; the phone, not knowing, sends 17:00 unchanged.
  const current = { title: 'A', notes: '', dueDate: '2026-09-29', dueTime: '10:00', completed: false, priority: 0 as const, listId: 'rl_errands' }
  const { fields, kept } = mergeIntoTask(current, { ...base }, base)
  assert.equal(fields.dueTime, '10:00')
  assert.deepEqual(kept, ['due'])
  // The phone changed the title: the phone's title, GOOYA's time.
  const both = mergeIntoTask(current, { ...base, title: 'B' }, base)
  assert.equal(both.fields.title, 'B')
  assert.equal(both.fields.dueTime, '10:00')
  // No base (an older app): the phone's version.
  assert.equal(mergeIntoTask(current, { ...base }, null).fields.dueTime, '17:00')
  // A task in the old single list moves to its Reminders list.
  assert.equal(mergeIntoTask({ ...current, listId: 'apple-reminders' }, { ...base }, base).fields.listId, 'rl_errands')
})

const hash = (s: string, n: number) => createHash('sha1').update(s).digest('hex').slice(0, n)

test('the phone’s lists become GOOYA lists, and reminders tasks in them', () => {
  const out = applyReminderImport('gooya', [], [], { lists: [{ id: 'L1', title: 'Errands', color: '#FF9500', writable: true, isDefault: true }], reminders: [toImport(reminder())], full: true, timezone: 'America/New_York' }, 5, hash)
  assert.equal(out.lists.length, 1)
  // Each list stands for a category: GOOYA had none named Errands, so one is made from it.
  assert.equal(out.categories.length, 1)
  assert.deepEqual({ ...out.categories[0], id: 'c' }, { id: 'c', name: 'Errands', color: '#ff9500', icon: 'list', order: 1, createdBy: 'gooya', createdAt: 5, updatedAt: 5 })
  assert.deepEqual({ ...out.lists[0], id: 'x' }, { id: 'x', name: 'Errands', color: '#ff9500', icon: 'list', order: 100, createdBy: 'gooya', createdAt: 5, updatedAt: 5, source: 'apple-reminders', owner: 'gooya', externalId: 'L1', readOnly: false, isDefault: true, categoryId: out.categories[0].id })
  assert.equal(out.created, 1)
  assert.equal(out.tasks[0].fields.listId, out.lists[0].id)
  assert.equal(out.tasks[0].fields.dueTime, '15:00')
})

test('nothing is written when nothing changed', () => {
  const lists = applyReminderImport('gooya', [], [], { lists: [{ id: 'L1', title: 'Errands', color: '#ff9500', writable: true, isDefault: false }], reminders: [], full: true, timezone: 'UTC' }, 5, hash).lists
  const r = reminder()
  const task = taskFrom(r, { listId: lists[0].id, externalRefs: [{ source: 'apple-reminders', accountId: 'gooya', calendarId: 'L1', externalId: 'r1' }] })
  const out = applyReminderImport('gooya', [task], lists, { lists: [{ id: 'L1', title: 'Errands', color: '#ff9500', writable: true, isDefault: false }], reminders: [toImport(r, { base: reminderFields(r) })], full: true, timezone: 'America/New_York' }, 9, hash)
  assert.deepEqual(out.tasks, [])
  assert.deepEqual(out.lists, [])
  assert.deepEqual(out.deleteTasks, [])
})

test('a reminder made from a GOOYA task takes that task over; unlinked and deleted ones', () => {
  const lists = applyReminderImport('gooya', [], [], { lists: [{ id: 'L2', title: 'School', color: '#34c759', writable: true, isDefault: false }], reminders: [], full: true, timezone: 'UTC' }, 5, hash).lists
  const own = gooyaTask({ listId: lists[0].id })
  const gone = taskFrom(reminder({ id: 'old' }), { id: 'ar_old' })
  const leaving = taskFrom(reminder({ id: 'r7' }), { id: 'ar_7' })
  const made = reminder({ id: 'new1', title: 'Buy stamps', listId: 'L2', dueTime: '10:00' })
  const out = applyReminderImport('gooya', [own, gone, leaving], lists, { lists: [{ id: 'L2', title: 'School', color: '#34c759', writable: true, isDefault: false }], reminders: [toImport(made, { taskId: 't9' })], unlink: ['ar_7'], full: true, timezone: 'UTC' }, 9, hash)
  const takeover = out.tasks.find((t) => t.id === 't9')!
  assert.equal(takeover.create, false)
  assert.equal(takeover.fields.source, 'apple-reminders')
  assert.equal(takeover.fields.externalRefs?.[0].externalId, 'new1')
  assert.deepEqual(out.tasks.find((t) => t.id === 'ar_7')?.fields, { source: 'gooya', externalRefs: [], updatedAt: 9 })
  assert.deepEqual(out.deleteTasks, ['ar_old'])
})

test('an older app (no lists) keeps using the single Apple Reminders list', () => {
  const out = applyReminderImport('gooya', [], [], { reminders: [{ id: 'r1', title: 'A', completed: false, list: 'Errands', dueDate: null, dueTime: null }], full: true, timezone: 'UTC' }, 5, hash)
  assert.equal(out.tasks[0].fields.listId, 'apple-reminders')
  assert.deepEqual(out.lists, [])
  assert.deepEqual(out.deleteLists, [])
})

test('a reminder that got a new id when it moved stays the same task', () => {
  const lists = applyReminderImport('gooya', [], [], { lists: [{ id: 'L1', title: 'Errands', color: '#ff9500', writable: true, isDefault: false }, { id: 'X9', title: 'Work', color: '#007aff', writable: true, isDefault: false }], reminders: [], full: true, timezone: 'UTC' }, 5, hash).lists
  const r = reminder()
  const task = taskFrom(r, { listId: lists[0].id })
  const movedTo = reminder({ id: 'r1-new', listId: 'X9' })
  const out = applyReminderImport('gooya', [task], lists, { lists: [{ id: 'L1', title: 'Errands', color: '#ff9500', writable: true, isDefault: false }, { id: 'X9', title: 'Work', color: '#007aff', writable: true, isDefault: false }], reminders: [toImport(movedTo, { taskId: 'ar_1' })], full: true, timezone: 'UTC' }, 9, hash)
  assert.deepEqual(out.deleteTasks, [])
  assert.equal(out.tasks.length, 1)
  assert.equal(out.tasks[0].id, 'ar_1')
  assert.equal(out.tasks[0].fields.externalRefs?.[0].externalId, 'r1-new')
  assert.equal(out.tasks[0].fields.listId, lists[1].id)
})

// ---------------------------------------------------------------- waking the iPhone that keeps the reminders
import { reminderWakeups } from './reminders'

test('a reminder changed in GOOYA wakes its owner’s iPhone; the sync’s own writes and other fields do not', () => {
  const r = { owner: 'gooya', source: 'apple-reminders', listId: 'rl_abc', title: 'Canvas quiz', dueDate: '2026-09-29', dueTime: '17:00', completed: true }
  assert.deepEqual(reminderWakeups(r, { ...r, dueDate: '2026-09-28', dueTime: '10:00', lastEdit: 'app' }), ['gooya'])
  assert.deepEqual(reminderWakeups(r, { ...r, dueDate: '2026-09-28', lastEdit: 'reminders' }), [])
  assert.deepEqual(reminderWakeups(r, { ...r, updatedAt: 5, lastEdit: 'app' }), [])
  assert.deepEqual(reminderWakeups(r, null), ['gooya'])
})

test('a GOOYA task put in a Reminders list wakes the iPhone that will make the reminder; other tasks never do', () => {
  const t = { owner: 'eunbi', source: 'gooya', listId: 'tasks', title: 'Milk' }
  assert.deepEqual(reminderWakeups(null, { ...t, listId: 'rl_groceries', lastEdit: 'app' }), ['eunbi'])
  assert.deepEqual(reminderWakeups(t, { ...t, title: 'Oat milk', lastEdit: 'app' }), [])
})

test('a reminder given to the other person wakes both iPhones', () => {
  const r = { owner: 'gooya', source: 'apple-reminders', listId: 'rl_abc', title: 'Call mom' }
  assert.deepEqual(reminderWakeups(r, { ...r, owner: 'eunbi', listId: 'tasks', source: 'apple-reminders' }), ['gooya', 'eunbi'])
})

// ---------------------------------------------------------------- categories as Reminders lists

const device = (id: string, title: string, color: string, extra: Partial<DeviceList> = {}): DeviceList => ({ id, title, color, writable: true, editable: true, isDefault: false, ...extra })
/** GOOYA's categories (Tasks, Groceries, School) and gooya's Reminders list L1 standing for Groceries. */
const CATS = [
  list('tasks', { name: 'Tasks', color: '#007aff', order: 0 }),
  list('groceries', { name: 'Groceries', color: '#34c759', order: 1 }),
  list('school', { name: 'School', color: '#5856d6', order: 2 }),
  list('rl_1', { name: 'Groceries', color: '#34c759', source: 'apple-reminders', owner: 'gooya', externalId: 'L1', categoryId: 'groceries' }),
]

test('a category a task is in gets a list on the owner’s iPhone: theirs, one of its name, or a new one', () => {
  const inCategory = (listId: string, extra: Partial<Task> = {}) => gooyaTask({ id: `t_${listId}`, listId, ...extra })
  const tasks = [inCategory('groceries'), inCategory('school'), inCategory('tasks', { owner: 'eunbi' })]
  const phone = [device('L1', 'Groceries', '#34c759'), device('L9', 'school', '#ff9500')]
  const plan = planCategoryLists('gooya', phone, tasks, CATS, {})
  // Groceries: the list that stands for it. School: the list of that name (any case), linked now. Tasks: eunbi's task.
  assert.deepEqual(plan.targets, { groceries: 'L1', school: 'L9' })
  assert.deepEqual(plan.link, [{ listId: 'L9', categoryId: 'school' }])
  assert.deepEqual(plan.create, [])
  // A list linked by name takes the category's name and colour.
  assert.deepEqual(plan.update, [{ listId: 'L9', title: 'School', color: '#5856d6' }])
  const none = planCategoryLists('gooya', [device('L1', 'Groceries', '#34c759')], [inCategory('school')], CATS, {})
  assert.deepEqual(none.create, [{ categoryId: 'school', title: 'School', color: '#5856d6' }])
})

test('a done or repeating task that never was a reminder makes no list; a list someone shared is not renamed', () => {
  const plan = planCategoryLists('gooya', [], [gooyaTask({ listId: 'school', completed: true }), gooyaTask({ id: 't2', listId: 'bills', rrule: 'FREQ=WEEKLY' })], CATS, {})
  assert.deepEqual(plan.create, [])
  const repeating = planReminderSync([], [gooyaTask({ listId: 'school', rrule: 'FREQ=WEEKLY;BYDAY=MO' })], {}, 'gooya', CATS, {}, undefined, { categoryTargets: { school: 'L9' } })
  assert.deepEqual(repeating.creates, [])
  const shared = planCategoryLists('gooya', [device('L1', 'Food', '#34c759', { editable: false })], [], CATS, { L1: { title: 'Food', color: '#34c759' } })
  assert.deepEqual(shared.update, [])
})

test('a category renamed or recoloured in GOOYA renames and recolours its list; one changed in Reminders is reported', () => {
  const agreed = { L1: { title: 'Groceries', color: '#34c759' } }
  const cats = CATS.map((c) => (c.id === 'groceries' ? { ...c, name: 'Food', color: '#ff9500' } : c))
  assert.deepEqual(planCategoryLists('gooya', [device('L1', 'Groceries', '#34c759')], [], cats, agreed).update, [{ listId: 'L1', title: 'Food', color: '#ff9500' }])
  const inReminders = planCategoryLists('gooya', [device('L1', 'Market', '#ff2d55')], [], CATS, agreed)
  assert.deepEqual(inReminders.update, [])
  assert.deepEqual(inReminders.report, [{ listId: 'L1', name: 'Market', color: '#ff2d55' }])
  // Reminders gives a colour back a step off: that is the same colour, not a change.
  assert.deepEqual(planCategoryLists('gooya', [device('L1', 'Groceries', '#33c85a')], [], CATS, agreed).update, [])
  assert.ok(sameColor('#34c759', '#33c85a'))
  assert.ok(!sameColor('#34c759', '#ff9500'))
})

test('with categories, a task in a category is a reminder in its list; a category with no list leaves the reminder be', () => {
  const r = reminder({ listId: 'L1' })
  const moved = taskFrom(r, { listId: 'school' })
  const plan = planReminderSync([r], [moved, gooyaTask({ listId: 'school' }), gooyaTask({ id: 't8', listId: 'school', completed: true })], baselineOf([r]), 'gooya', [...LISTS, ...CATS], {}, undefined, { categoryTargets: { school: 'L9' } })
  assert.deepEqual(plan.changes, [{ id: 'r1', listId: 'L9' }])
  assert.deepEqual(plan.unlink, [])
  assert.deepEqual(plan.creates.map((c) => [c.taskId, c.listId]), [['t9', 'L9']])
  const stays = planReminderSync([r], [moved], baselineOf([r]), 'gooya', [...LISTS, ...CATS], {}, undefined, { categoryTargets: {} })
  assert.deepEqual(stays.changes, [])
  assert.deepEqual(stays.unlink, [])
})

test('a task with a time made in another time zone is at the same moment on the phone’s clock', () => {
  // 10:00 AM in Seoul is 9:00 PM the evening before in New York (EDT).
  assert.deepEqual(dueOnPhone({ dueDate: '2026-10-01', dueTime: '10:00', timezone: 'Asia/Seoul' }, 'America/New_York'), { dueDate: '2026-09-30', dueTime: '21:00' })
  // A day without a time is that day anywhere.
  assert.deepEqual(dueOnPhone({ dueDate: '2026-10-01', dueTime: null, timezone: 'Asia/Seoul' }, 'America/New_York'), { dueDate: '2026-10-01', dueTime: null })
  const plan = planReminderSync([], [gooyaTask({ listId: 'rl_errands', dueDate: '2026-10-01', dueTime: '10:00', timezone: 'Asia/Seoul' })], {}, 'gooya', LISTS, {}, undefined, { zone: 'America/New_York' })
  assert.deepEqual([plan.creates[0].dueDate, plan.creates[0].dueTime], ['2026-09-30', '21:00'])
})

test('the server links a list to the category of its name, or the one the phone linked, and takes its renames', () => {
  const lists = [...CATS.filter((c) => !c.source)]
  // "school" is the School category (names compare without case): nothing new is made.
  const byName = applyReminderImport('gooya', [], lists, { lists: [device('L9', 'school', '#5856d6')], reminders: [], full: true, timezone: 'UTC' }, 5, hash)
  assert.deepEqual(byName.categories, [])
  assert.equal(byName.lists[0].categoryId, 'school')
  // The phone linked L7 to Groceries (it made the list for it).
  const linked = applyReminderImport('gooya', [], lists, { lists: [device('L7', 'Groceries 2', '#34c759', { categoryId: 'groceries' })], reminders: [], full: true, timezone: 'UTC' }, 5, hash)
  assert.equal(linked.lists[0].categoryId, 'groceries')
  assert.deepEqual(linked.categories, [])
  // Renamed and recoloured in Reminders: the category too.
  const withList = [...lists, list(`rl_${hash('gooya:L1', 16)}`, { source: 'apple-reminders', owner: 'gooya', externalId: 'L1', categoryId: 'groceries' })]
  const renamed = applyReminderImport('gooya', [], withList, { lists: [device('L1', 'Market', '#FF2D55', { categoryName: 'Market', categoryColor: '#FF2D55' })], reminders: [], full: true, timezone: 'UTC' }, 7, hash)
  assert.deepEqual(renamed.categories.map((c) => [c.id, c.name, c.color, c.updatedAt]), [['groceries', 'Market', '#ff2d55', 7]])
})

test('a list whose category was deleted stands for none, until a category of its name is made', () => {
  const rl = list(`rl_${hash('gooya:L1', 16)}`, { source: 'apple-reminders', owner: 'gooya', externalId: 'L1', categoryId: '' })
  const out = applyReminderImport('gooya', [], [rl, ...CATS.filter((c) => c.id === 'tasks')], { lists: [device('L1', 'Groceries', '#34c759')], reminders: [], full: true, timezone: 'UTC' }, 5, hash)
  assert.deepEqual(out.categories, [])
  assert.equal(out.lists.length ? out.lists[0].categoryId : rl.categoryId, '')
  const again = applyReminderImport('gooya', [], [rl, ...CATS.filter((c) => !c.source)], { lists: [device('L1', 'Groceries', '#34c759')], reminders: [], full: true, timezone: 'UTC' }, 5, hash)
  assert.equal(again.lists[0].categoryId, 'groceries')
})
