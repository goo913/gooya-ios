import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

/**
 * Sizes that follow Apple Calendar (iOS 26/27), measured point by point against it on an iPhone 15 at the default
 * Text Size and at two steps larger (Settings → Display & Brightness → Text Size).
 *
 * Apple does not grow everything alike when the Text Size is raised:
 * - the bars (the "‹ 2026" back pill, the view · search · add icons, "Today") follow Text Size fully, like body text;
 * - the month grid (day numbers, weekday letters, event chips, the "Oct" labels) grows about three quarters as much;
 * - the month title, the today circle and the bottom bar's icons do not grow at all.
 *
 * React Native would grow every text by the full Text Size factor (fontScale), which made GOOYA's calendar much bigger
 * than Apple's on a phone with larger text. So the calendar's texts are drawn with allowFontScaling={false}, at the
 * sizes worked out here. (Sheets and settings keep React Native's scaling, which matches Apple's for body text.)
 */
export interface Metrics {
  /** The phone's Text Size factor (1 at the default size, 1.235 two steps up). */
  fontScale: number;
  /** How much the bars grow. */
  bar: number;
  /** How much the month grid grows. */
  grid: number;

  // ---- bars
  barHeight: number;
  bottomBarHeight: number;
  barText: number;
  backChevron: number;
  barButtonWidth: number;
  /** The view · search · add buttons' widths: Apple spaces the three glyphs evenly, not the buttons. */
  barButtonWidths: [number, number, number];
  viewIcon: number;
  searchIcon: number;
  addIcon: number;

  // ---- month
  monthTitle: number;
  monthTitleLineHeight: number;
  weekday: number;
  dayNumber: number;
  todayCircle: number;
  /** From a row's top line to the top of the today circle. */
  circleTop: number;
  /** From a row's top line to its first chip. */
  chipsTop: number;
  chipHeight: number;
  chipGap: number;
  chipText: number;
  chipRing: number;
  chipRadius: number;
  rowHeight: number;
  monthLabel: number;
  labelHeight: number;
  chipsPerDay: number;

  // ---- day (the timeline grows faster than body text in Apple Calendar: about 1.4× two steps up)
  day: number;
  /** Points per hour at the default Text Size, before the person's pinch zoom. */
  hourHeightBase: number;
  gutter: number;
  hourNumber: number;
  hourSuffix: number;
  noon: number;
  nowText: number;
  nowHeight: number;
  weekStrip: number;
  weekLetter: number;
  weekNumber: number;
  weekMarkHeight: number;
  weekMarkWidth: number;
  weekMarkRadius: number;
  /** From the strip's top to the centre of its dates. */
  weekDateCenter: number;
  dayTitle: number;
  dayTitleBand: number;
  personName: number;
  eventTitle: number;
  eventTime: number;
  taskRing: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function metricsFor(fontScale: number): Metrics {
  const bar = clamp(fontScale, 0.82, 1.36);
  const grid = clamp(1 + 0.77 * (fontScale - 1), 0.86, 1.3);
  const chipHeight = Math.round(16 * grid);
  const chipGap = Math.round(3 * grid);
  const chipsPerDay = 3;
  const chipsTop = 55.33;
  return {
    fontScale,
    bar,
    grid,
    barHeight: 44,
    bottomBarHeight: 48,
    barText: 17 * bar,
    backChevron: 23 * bar,
    barButtonWidth: 53.6 * (1 + (bar - 1) / 2),
    barButtonWidths: [51.7, 63, 45.7].map((w) => w * (1 + (bar - 1) * 0.55)) as [number, number, number],
    viewIcon: 29.5 * bar,
    searchIcon: 26 * bar,
    addIcon: 22.5 * bar,
    monthTitle: 33,
    monthTitleLineHeight: 40,
    weekday: 10 * grid,
    dayNumber: 18 * grid,
    todayCircle: 39.33,
    circleTop: 9.05,
    chipsTop,
    chipHeight,
    chipGap,
    chipText: 11 * grid,
    chipRing: 10.5 * grid,
    chipRadius: 5,
    // Apple: the chips' slots, then 10 points under the last one (119.33 at the default Text Size, 130.33 two steps up).
    rowHeight: chipsTop + chipsPerDay * chipHeight + (chipsPerDay - 1) * chipGap + 10,
    monthLabel: 20 * grid,
    labelHeight: Math.round(26 * grid),
    chipsPerDay,
    ...dayMetrics(fontScale, grid),
  };
}

function dayMetrics(fontScale: number, grid: number) {
  const day = clamp(1 + 1.7 * (fontScale - 1), 0.75, 1.6);
  const weekMarkHeight = 34.3 - (grid - 1) * 22;
  return {
    day,
    hourHeightBase: 50,
    gutter: 63.3 * (1 + 0.63 * (fontScale - 1)),
    hourNumber: 14.2 * day,
    hourSuffix: 8.5 * day,
    noon: 12 * day,
    nowText: 12.3 * day,
    nowHeight: 16.7 * day,
    weekStrip: 62 + (grid - 1) * 37.2,
    weekLetter: 10 * grid,
    weekNumber: 18 * grid,
    weekMarkHeight,
    weekMarkWidth: Math.max(weekMarkHeight, 35 + (grid - 1) * 11),
    // A circle at the default Text Size; a rounded square once the numbers outgrow it (as Apple draws it).
    weekMarkRadius: grid > 1.06 ? 9 : weekMarkHeight / 2,
    weekDateCenter: 47.8 - (grid - 1) * 21,
    dayTitle: 15 * grid,
    dayTitleBand: 36,
    personName: 11 * grid,
    eventTitle: 13.3 * day,
    eventTime: 12.3 * day,
    taskRing: 14 * day,
  };
}

/** The calendar's sizes for the phone's current Text Size (they update when it changes). */
export function useMetrics(): Metrics {
  const { fontScale } = useWindowDimensions();
  return useMemo(() => metricsFor(fontScale), [fontScale]);
}
