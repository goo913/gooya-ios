import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TaskList } from './model'
import { categoriesOf, categoryOfList, defaultListFor, indexLists, listForCategory, sameNamed, scheduleColor, taskColor } from './categories'

const list = (id: string, extra: Partial<TaskList> = {}): TaskList => ({ id, name: id, color: '#8e8e93', icon: 'list', order: 1, createdBy: 'gooya', createdAt: 0, updatedAt: 0, ...extra })
const LISTS = [
  list('tasks', { name: 'Tasks', color: '#007aff', order: 0 }),
  list('bills', { name: 'Bills', color: '#34c759', order: 2 }),
  list('school', { name: 'School', color: '#5856d6', order: 1 }),
  // gooya's Reminders lists: "Reminders" (default) stands for Tasks, "Canvas" for School, "Old" for none (deleted).
  list('rl_default', { name: 'Reminders', color: '#ff9500', source: 'apple-reminders', owner: 'gooya', externalId: 'L0', isDefault: true, categoryId: 'tasks' }),
  list('rl_canvas', { name: 'Canvas', color: '#ff0000', source: 'apple-reminders', owner: 'gooya', externalId: 'L1', categoryId: 'school' }),
  list('rl_old', { name: 'Old', color: '#a2845e', source: 'apple-reminders', owner: 'gooya', externalId: 'L2', categoryId: '' }),
]
const byId = indexLists(LISTS)

test('categories are GOOYA’s own lists, in their order', () => {
  assert.deepEqual(categoriesOf(LISTS).map((c) => c.id), ['tasks', 'school', 'bills'])
})

test('a task’s category and colour: its list, or the category its Reminders list stands for', () => {
  assert.equal(categoryOfList('bills', byId)?.id, 'bills')
  assert.equal(categoryOfList('rl_canvas', byId)?.id, 'school')
  assert.equal(categoryOfList('rl_old', byId), null)
  assert.equal(taskColor({ listId: 'rl_canvas' }, byId), '#5856d6')
  // A Reminders list in no category keeps its own colour.
  assert.equal(taskColor({ listId: 'rl_old' }, byId), '#a2845e')
  assert.equal(taskColor({ listId: 'gone' }, byId), null)
})

test('a schedule’s colour: its own, else its category’s, else none (its owner’s)', () => {
  assert.equal(scheduleColor({ color: '#ff2d55', categoryId: 'bills' }, byId), '#ff2d55')
  assert.equal(scheduleColor({ color: null, categoryId: 'bills' }, byId), '#34c759')
  assert.equal(scheduleColor({ color: null, categoryId: null }, byId), null)
  // Pointing at a Reminders list is no category.
  assert.equal(scheduleColor({ color: null, categoryId: 'rl_canvas' }, byId), null)
})

test('a task in a category goes in its owner’s Reminders list for it, or the category itself', () => {
  assert.equal(listForCategory('school', 'gooya', LISTS), 'rl_canvas')
  assert.equal(listForCategory('school', 'eunbi', LISTS), 'school')
  assert.equal(listForCategory('bills', 'gooya', LISTS), 'bills')
  assert.equal(defaultListFor('gooya', LISTS), 'rl_default')
  assert.equal(defaultListFor('eunbi', LISTS), 'tasks')
})

test('names compare without case or spaces', () => {
  assert.equal(sameNamed(' bills ', LISTS)?.id, 'bills')
  assert.equal(sameNamed('Bills', LISTS, 'bills'), null)
  // A Reminders list of that name is not a category.
  assert.equal(sameNamed('Canvas', LISTS), null)
})
