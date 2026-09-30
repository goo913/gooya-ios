// One week row of a month grid, as Apple Calendar lays it out: something on several days is one bar across them (in
// each week row it reaches, its title at the row's start), everything else a chip in its day; bars take the top lines,
// chips the free lines under and between them. A day with more than fits shows "+N" in its last line. Pure, shared by
// the iPhone's and the iPad's months.

import type { DateKey } from './model'

export interface RowPiece<T> {
  /** A bar (part of something on several days) or a chip (something on one day). */
  kind: 'bar' | 'chip'
  item: T
  /** Unique within the row (an item's bar can be cut in two by a full day). */
  key: string
  /** The line, from the top (0). */
  line: number
  /** The first and last columns it covers (0 = Sunday). */
  from: number
  to: number
  /** It goes on before or after this piece: that end is square, flush with the day's edge. */
  openStart: boolean
  openEnd: boolean
}

export interface RowLayout<T> {
  pieces: RowPiece<T>[]
  /** Per column with more than fits: how many are not shown ("+N", in the last line). */
  more: Map<number, number>
}

export interface RowInput<T> {
  /** The row's seven days; null for a column outside the month. */
  days: (DateKey | null)[]
  /** What is on several days, with the days each covers (in order). */
  spans: { item: T; key: string; days: DateKey[] }[]
  /** Everything else, per day, in the order it is listed. */
  singles: Map<DateKey, { item: T; key: string }[]>
  /** Lines a day has room for. */
  lines: number
}

export function layoutRow<T>({ days, spans, singles, lines }: RowInput<T>): RowLayout<T> {
  const colOf = new Map<DateKey, number>()
  days.forEach((d, c) => d && colOf.set(d, c))
  // Each span's part in this row: the columns of its days here.
  const segs: { item: T; key: string; from: number; to: number; openStart: boolean; openEnd: boolean; start: number; line: number }[] = []
  const seen = new Set<string>()
  spans.forEach((s, order) => {
    if (seen.has(s.key)) return
    seen.add(s.key)
    const cols = s.days.map((d) => colOf.get(d)).filter((c): c is number => c !== undefined)
    if (!cols.length) return
    const from = Math.min(...cols)
    const to = Math.max(...cols)
    segs.push({ item: s.item, key: s.key, from, to, openStart: s.days[0] < days[from]!, openEnd: s.days[s.days.length - 1] > days[to]!, start: order, line: 0 })
  })
  // Longest first where they start together (Apple's order), then as listed.
  segs.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || a.start - b.start)
  const taken: boolean[][] = []
  const free = (line: number, from: number, to: number) => {
    for (let c = from; c <= to; c++) if (taken[line]?.[c]) return false
    return true
  }
  for (const s of segs) {
    let line = 0
    while (!free(line, s.from, s.to)) line++
    s.line = line
    taken[line] ??= []
    for (let c = s.from; c <= s.to; c++) taken[line][c] = true
  }
  // Chips in the lines their day has free, top down.
  const chips: { item: T; key: string; col: number; line: number }[] = []
  const total = new Map<number, number>()
  days.forEach((d, c) => {
    if (!d) return
    let line = 0
    let n = segs.filter((s) => s.from <= c && c <= s.to).length
    for (const x of singles.get(d) ?? []) {
      while (taken[line]?.[c]) line++
      chips.push({ item: x.item, key: x.key, col: c, line })
      line++
      n++
    }
    total.set(c, n)
  })
  // A day with more than fits keeps its last line for "+N".
  const limit = (c: number) => ((total.get(c) ?? 0) > lines ? lines - 1 : lines)
  const pieces: RowPiece<T>[] = []
  for (const s of segs) {
    // The columns where it is seen, in runs: a full day cuts a bar.
    let run: number | null = null
    for (let c = s.from; c <= s.to + 1; c++) {
      const shown = c <= s.to && s.line < limit(c)
      if (shown && run === null) run = c
      if (!shown && run !== null) {
        pieces.push({ kind: 'bar', item: s.item, key: `${s.key}#${run}`, line: s.line, from: run, to: c - 1, openStart: run > s.from || s.openStart, openEnd: c - 1 < s.to || s.openEnd })
        run = null
      }
    }
  }
  for (const x of chips) if (x.line < limit(x.col)) pieces.push({ kind: 'chip', item: x.item, key: x.key, line: x.line, from: x.col, to: x.col, openStart: false, openEnd: false })
  const more = new Map<number, number>()
  for (const [c, n] of total) {
    const shown = pieces.filter((p) => p.from <= c && c <= p.to).length
    if (n > shown) more.set(c, n - shown)
  }
  return { pieces, more }
}
