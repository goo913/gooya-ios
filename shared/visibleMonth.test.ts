import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dominantMonth } from './visibleMonth'

// The iPhone's months: each month's weeks, then the next month's name ("Nov") in a row of its own. Rows of 100 points,
// the name's row 40; September 2026 has 5 weeks, October 5, November 5, December 5.
const ROW = 100
const LABEL = 40
const WEEKS = [5, 5, 5, 5]
const heights = WEEKS.map((w) => w * ROW)
const tops: number[] = []
let y = 0
for (const h of heights) {
  tops.push(y)
  y += h + LABEL
}
const [SEP, OCT, NOV] = [0, 1, 2]
const VIEW = 650

test('November in view with its name at the top (no day of October left): November', () => {
  const from = tops[NOV] - LABEL
  assert.equal(dominantMonth(tops, heights, from, from + VIEW), NOV)
})

test('a sliver of October’s last week above November: November', () => {
  const from = tops[NOV] - LABEL - 30
  assert.equal(dominantMonth(tops, heights, from, from + VIEW), NOV)
})

test('October’s last week whole above most of November: November', () => {
  const from = tops[NOV] - LABEL - ROW
  assert.equal(dominantMonth(tops, heights, from, from + VIEW), NOV)
})

test('a month aligned at its first week (Today, or picked in the year): that month, though the next one shows under it', () => {
  assert.equal(dominantMonth(tops, heights, tops[OCT], tops[OCT] + VIEW), OCT)
  assert.equal(dominantMonth(tops, heights, tops[SEP], tops[SEP] + VIEW), SEP)
})

test('as much of each: the earlier month', () => {
  // 250 points of October's weeks and 250 of November's, the name's row between them.
  const from = tops[OCT] + 250
  assert.equal(dominantMonth(tops, heights, from, from + 250 + LABEL + 250), OCT)
})

test('the iPad’s months (no name rows): the month filling most of the screen', () => {
  const padHeights = [5, 6, 5].map((w) => w * 110)
  const padTops = [0, 550, 1210]
  assert.equal(dominantMonth(padTops, padHeights, 0, 900), 0)
  assert.equal(dominantMonth(padTops, padHeights, 300, 1200), 1)
  assert.equal(dominantMonth(padTops, padHeights, 1150, 2000), 2)
})

test('scrolled past either end, or nothing in view: the nearest month', () => {
  assert.equal(dominantMonth(tops, heights, -200, -100), SEP)
  assert.equal(dominantMonth(tops, heights, 99_999, 100_500), tops.length - 1)
  assert.equal(dominantMonth(tops, heights, tops[OCT] + 10, tops[OCT] + 10), OCT)
  assert.equal(dominantMonth([], [], 0, 100), 0)
})
