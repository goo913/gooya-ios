import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutRow } from './monthRows'

// The week of Sunday, September 27, 2026 (Wednesday the 30th, then October 1–3).
const WEEK = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']
const one = (key: string) => ({ item: key, key })
const shape = (pieces: { kind: string; key: string; line: number; from: number; to: number; openStart: boolean; openEnd: boolean }[]) =>
  pieces.map((p) => `${p.kind} ${p.key} line${p.line} ${p.from}-${p.to}${p.openStart ? ' <' : ''}${p.openEnd ? ' >' : ''}`)

test('something on four days is one bar across them; a chip goes under it on its day', () => {
  const { pieces, more } = layoutRow({
    days: WEEK,
    spans: [{ item: 'test2', key: 'test2', days: ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'] }],
    singles: new Map([['2026-10-01', [one('call')]], ['2026-09-28', [one('avena')]]]),
    lines: 3,
  })
  assert.deepEqual(shape(pieces), ['bar test2#3 line0 3-6', 'chip avena line0 1-1', 'chip call line1 4-4'])
  assert.equal(more.size, 0)
})

test('a bar that began in an earlier week, or goes on into the next, is square at that end', () => {
  const { pieces } = layoutRow({
    days: WEEK,
    spans: [{ item: 'trip', key: 'trip', days: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'] }, { item: 'seoul', key: 'seoul', days: ['2026-10-03', '2026-10-04'] }],
    singles: new Map(),
    lines: 3,
  })
  assert.deepEqual(shape(pieces), ['bar trip#0 line0 0-1 <', 'bar seoul#6 line0 6-6 >'])
})

test('a month that starts mid-week: the bar covers only the month’s days in the row', () => {
  const october = [null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']
  const { pieces } = layoutRow({ days: october, spans: [{ item: 'test2', key: 'test2', days: ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'] }], singles: new Map(), lines: 3 })
  assert.deepEqual(shape(pieces), ['bar test2#4 line0 4-6 <'])
})

test('bars stack, longest first; chips fill the free lines between them', () => {
  const { pieces } = layoutRow({
    days: WEEK,
    spans: [{ item: 'b', key: 'b', days: ['2026-09-29', '2026-09-30'] }, { item: 'a', key: 'a', days: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'] }, { item: 'c', key: 'c', days: ['2026-10-01', '2026-10-02'] }],
    singles: new Map([['2026-10-01', [one('x')]]]),
    lines: 4,
  })
  assert.deepEqual(shape(pieces), ['bar a#1 line0 1-4', 'bar b#2 line1 2-3', 'bar c#4 line1 4-5', 'chip x line2 4-4'])
})

test('a full day keeps its last line for "+N", and a bar in that line is cut there', () => {
  const { pieces, more } = layoutRow({
    days: WEEK,
    spans: [{ item: 'a', key: 'a', days: ['2026-09-29', '2026-09-30', '2026-10-01'] }, { item: 'b', key: 'b', days: ['2026-09-29', '2026-09-30', '2026-10-01'] }],
    singles: new Map([['2026-09-30', [one('x'), one('y')]]]),
    lines: 2,
  })
  // Wednesday has 4 things in 2 lines: a, then "+3" (b, x and y); b is shown on Tuesday and Thursday.
  assert.deepEqual(shape(pieces), ['bar a#2 line0 2-4', 'bar b#2 line1 2-2 >', 'bar b#4 line1 4-4 <'])
  assert.deepEqual([...more], [[3, 3]])
})
