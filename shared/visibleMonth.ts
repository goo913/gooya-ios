// Which month a scrolled list of months is showing, for its title: the month whose weeks fill most of what is in view
// (as Apple Calendar's title follows while scrolling), so the title never names a month that has scrolled away. Pure,
// shared by the iPhone's and the iPad's months.

/**
 * `tops[i]` is where month i's weeks begin in the list and `heights[i]` how tall they are (a row with a month's name is
 * not counted: it shows no days); `from` to `to` is the part of the list in view. The months are in order. On a tie,
 * the earlier month; with nothing in view, the month at `from`.
 */
export function dominantMonth(tops: readonly number[], heights: readonly number[], from: number, to: number): number {
  const n = tops.length
  if (!n) return 0
  // The first month whose weeks reach into view (the tops increase).
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] + heights[mid] <= from) lo = mid + 1
    else hi = mid
  }
  let best = lo
  let bestShown = 0
  for (let i = lo; i < n && tops[i] < to; i++) {
    const shown = Math.min(tops[i] + heights[i], to) - Math.max(tops[i], from)
    if (shown > bestShown) {
      best = i
      bestShown = shown
    }
  }
  return best
}
