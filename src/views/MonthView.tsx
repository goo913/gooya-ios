import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { DAY_MS, addDaysKey, makeKey, parseKey, startOfDayMs, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventChip, TaskChip } from "@/components/Chips";
import { MONTH_NAMES, MONTH_SHORT, WEEKDAY_LETTERS } from "@/lib/format";
import { useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { useFilteredPeople } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useSheets } from "@/store/sheets";
import { router } from "expo-router";
import { usePrefs } from "@/store/prefs";
import { ListView } from "./ListView";
import { useColors, type Colors } from "@/theme";

/** Space kept under the month title for the pills above it: the title's line starts this far below the safe area. */
export const TITLE_TOP = 59;
const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;

interface Block {
  y: number;
  m: number;
  startCol: number;
  days: number;
  rows: number;
  height: number;
  gridStartKey: DateKey;
}

interface MonthLayout {
  rowH: number;
  labelH: number;
  blocks: Block[];
  offsets: number[];
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const layouts = new Map<string, MonthLayout>();

/**
 * Every month from FIRST_YEAR to LAST_YEAR as one block: the month's rows, then the NEXT month's label ("Oct") under
 * them, so a block starts exactly at its first row and aligning to a month is aligning to its block. Row heights follow
 * the Text Size (lib/metrics.ts), so the blocks are worked out per row height.
 */
function monthLayout(rowH: number, labelH: number): MonthLayout {
  const cacheKey = `${rowH}:${labelH}`;
  const cached = layouts.get(cacheKey);
  if (cached) return cached;
  const blocks: Block[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    for (let m = 1; m <= 12; m++) {
      const firstKey = makeKey(y, m, 1);
      const startCol = weekdayOfKey(firstKey);
      const days = daysInMonth(y, m);
      const rows = Math.ceil((startCol + days) / 7);
      const height = rows * rowH + labelH;
      blocks.push({ y, m, startCol, days, rows, height, gridStartKey: addDaysKey(firstKey, -startCol) });
      offsets.push(offset);
      offset += height;
    }
  }
  const layout = { rowH, labelH, blocks, offsets };
  layouts.set(cacheKey, layout);
  return layout;
}

function blockIndexFor(monthKey: DateKey, layout: MonthLayout): number {
  const { y, m } = parseKey(monthKey);
  return Math.min(layout.blocks.length - 1, Math.max(0, (y - FIRST_YEAR) * 12 + (m - 1)));
}

function titleIndexForScroll(scrollTop: number, layout: MonthLayout): number {
  let lo = 0;
  let hi = layout.blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.offsets[mid] - layout.labelH * 0.5 <= scrollTop) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function MonthView({ monthKey, onPickDay, onHoldDay }: { monthKey: DateKey; onPickDay: (key: DateKey) => void; onHoldDay?: (key: DateKey) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const metrics = useMetrics();
  const layout = useMemo(() => monthLayout(metrics.rowHeight, metrics.labelHeight), [metrics.rowHeight, metrics.labelHeight]);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const listRef = useRef<FlatList<Block>>(null);
  const today = useToday();
  const people = useFilteredPeople();
  const todayNonce = useNav((s) => s.todayNonce);
  const setVisibleMonth = useNav((s) => s.setVisibleMonth);
  const initialIndex = useMemo(() => blockIndexFor(monthKey, layout), [monthKey, layout]);
  const [titleIdx, setTitleIdx] = useState(initialIndex);
  const [range, setRange] = useState({ first: initialIndex, last: initialIndex });

  const scrollToBlock = useCallback((idx: number, animated: boolean) => {
    listRef.current?.scrollToOffset({ offset: layoutRef.current.offsets[idx], animated });
  }, []);

  // A new month asked for (the year screen): align to it.
  const shown = useRef(initialIndex);
  useEffect(() => {
    if (shown.current === initialIndex) return;
    shown.current = initialIndex;
    scrollToBlock(initialIndex, false);
  }, [initialIndex, scrollToBlock]);

  useEffect(() => {
    if (todayNonce > 0) scrollToBlock(blockIndexFor(`${today.slice(0, 7)}-01`, layoutRef.current), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNonce]);

  useEffect(() => {
    const b = layout.blocks[titleIdx];
    setVisibleMonth(makeKey(b.y, b.m, 1));
  }, [titleIdx, setVisibleMonth, layout]);

  const windowStart = useMemo(() => startOfDayMs(layout.blocks[range.first].gridStartKey, viewerTz) - DAY_MS, [range.first, layout]);
  const windowEnd = useMemo(() => {
    const b = layout.blocks[range.last];
    return startOfDayMs(addDaysKey(b.gridStartKey, b.rows * 7), viewerTz) + DAY_MS;
  }, [range.last, layout]);
  const byDay = useTasksByDay(windowStart, windowEnd, people, viewerTz);
  const eventsByDay = useEventsByDay(windowStart, windowEnd, people, viewerTz);

  // The list's own initial positioning (initialScrollIndex) can land a little short on a cold start; align it
  // ourselves once the content is laid out, and correct the first scroll event if it still is not.
  const settled = useRef(false);
  const settle = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    scrollToBlock(shown.current, false);
    setTimeout(() => scrollToBlock(shown.current, false), 120);
  }, [scrollToBlock]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const aligned = layoutRef.current.offsets[shown.current];
      if (!settled.current && Math.abs(y - aligned) > 1 && Math.abs(y - aligned) < 80) settle();
      const idx = titleIndexForScroll(y, layoutRef.current);
      setTitleIdx((cur) => (cur === idx ? cur : idx));
    },
    [settle],
  );
  // One function for the list's lifetime: FlatList refuses a changing onViewableItemsChanged.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<Block>[] }) => {
    if (!viewableItems.length) return;
    const idxs = viewableItems.map((v) => v.index ?? 0);
    setRange((r) => {
      const first = Math.min(...idxs);
      const last = Math.max(...idxs);
      return r.first === first && r.last === last ? r : { first, last };
    });
  });

  const display = usePrefs((s) => s.monthDisplay);
  const title = layout.blocks[titleIdx];
  const renderItem = useCallback(
    ({ item }: { item: Block }) => <MonthBlock block={item} layout={layout} metrics={metrics} width={width} today={today} byDay={byDay} eventsByDay={eventsByDay} colors={colors} onPick={onPickDay} onHold={onHoldDay} />,
    [layout, metrics, width, today, byDay, eventsByDay, colors, onPickDay, onHoldDay],
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + TITLE_TOP, borderBottomColor: colors.separator }]}>
        <Text allowFontScaling={false} style={[styles.title, { color: colors.label, fontSize: metrics.monthTitle, lineHeight: metrics.monthTitleLineHeight }]}>
          {MONTH_NAMES[title.m - 1]}
        </Text>
        {display === "list" ? null : (
          <View style={styles.weekdays}>
            {WEEKDAY_LETTERS.map((l, i) => (
              <Text key={i} allowFontScaling={false} style={[styles.weekday, { color: colors.label, fontSize: metrics.weekday }]}>
                {l}
              </Text>
            ))}
          </View>
        )}
      </View>
      {display === "list" ? (
        <ListView />
      ) : (
      <FlatList
        key={layout.rowH}
        ref={listRef}
        data={layout.blocks}
        keyExtractor={(b) => `${b.y}-${b.m}`}
        renderItem={renderItem}
        getItemLayout={(_, i) => ({ length: layout.blocks[i].height, offset: layout.offsets[i], index: i })}
        initialScrollIndex={initialIndex}
        onContentSizeChange={() => requestAnimationFrame(settle)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
        windowSize={5}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        style={styles.fill}
      />
      )}
    </View>
  );
}

interface MonthBlockProps {
  block: Block;
  layout: MonthLayout;
  metrics: Metrics;
  width: number;
  today: DateKey;
  byDay: Map<DateKey, TaskOccurrence[]>;
  eventsByDay: Map<DateKey, EventOccurrence[]>;
  colors: Colors;
  onPick: (key: DateKey) => void;
  onHold?: (key: DateKey) => void;
}

const MonthBlock = memo(function MonthBlock({ block, layout, metrics, width, today, byDay, eventsByDay, colors, onPick, onHold }: MonthBlockProps) {
  const { y, m, startCol, days, rows } = block;
  const { rowH, labelH } = layout;
  const colW = width / 7;
  const lastCol = (startCol + days - 1) % 7;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const left = r === 0 ? startCol * colW : 0;
    const right = r === rows - 1 ? (6 - lastCol) * colW : 0;
    lines.push(<View key={`l${r}`} style={[styles.line, { top: r * rowH, left, right, backgroundColor: colors.separator }]} />);
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const dayIndex = r * 7 + c - startCol;
      if (dayIndex < 0 || dayIndex >= days) continue;
      const day = dayIndex + 1;
      const key = makeKey(y, m, day);
      cells.push(<DayCell key={key} dateKey={key} day={day} col={c} row={r} colW={colW} rowH={rowH} metrics={metrics} isToday={key === today} occurrences={byDay.get(key)} events={eventsByDay.get(key)} colors={colors} onPick={onPick} onHold={onHold} />);
    }
  }
  const next = layout.blocks[(y - FIRST_YEAR) * 12 + m] ?? null;
  return (
    <View style={{ height: block.height, width }}>
      {lines}
      {cells}
      {next ? (
        // The next month's name sits just above its first row's line, over the column of its 1st, as in Apple Calendar.
        <View style={[styles.label, { left: next.startCol * colW + 9.4, top: rows * rowH, height: labelH, paddingBottom: Math.max(0, 7.3 - 0.241 * metrics.monthLabel) }]}>
          <Text allowFontScaling={false} style={[styles.labelText, { color: colors.label, fontSize: metrics.monthLabel }]}>
            {MONTH_SHORT[next.m - 1]}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

interface DayCellProps {
  dateKey: DateKey;
  day: number;
  col: number;
  row: number;
  colW: number;
  rowH: number;
  metrics: Metrics;
  isToday: boolean;
  occurrences?: TaskOccurrence[];
  events?: EventOccurrence[];
  colors: Colors;
  onPick: (key: DateKey) => void;
  onHold?: (key: DateKey) => void;
}

const DayCell = memo(function DayCell({ dateKey, day, col, row, colW, rowH, metrics, isToday, occurrences, events, colors, onPick, onHold }: DayCellProps) {
  const weekend = col === 0 || col === 6;
  const max = metrics.chipsPerDay;
  const list: (TaskOccurrence | EventOccurrence)[] = [...(events ?? []), ...(occurrences ?? [])];
  const overflow = list.length > max ? list.length - (max - 1) : 0;
  const visible = overflow ? list.slice(0, max - 1) : list;
  const d = metrics.todayCircle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenDate(dateKey)}
      accessibilityValue={{ text: list.length ? `${list.length} ${list.length === 1 ? "item" : "items"}` : "" }}
      accessibilityHint="Opens the day. Touch and hold to add a task on it."
      testID={dateKey}
      onPress={() => onPick(dateKey)}
      // Touch and hold a day to start a task on it, as Apple Calendar starts an event.
      onLongPress={onHold ? () => onHold(dateKey) : undefined}
      delayLongPress={450}
      style={[styles.cell, { left: col * colW, width: colW, top: row * rowH, height: rowH }]}
    >
      <View style={[styles.number, { marginTop: metrics.circleTop, width: d, height: d, borderRadius: d / 2 }, isToday && { backgroundColor: colors.red }]}>
        <Text allowFontScaling={false} style={[styles.numberText, { fontSize: metrics.dayNumber, color: isToday ? "#ffffff" : weekend ? colors.gray : colors.label }]}>
          {day}
        </Text>
      </View>
      <View style={[styles.chips, { top: metrics.chipsTop, gap: metrics.chipGap }]}>
        {visible.map((o) => (
          // A chip opens its details, as in Apple Calendar; the rest of the day opens the day.
          <Pressable key={o.key} accessibilityRole="button" accessibilityLabel={o.title} onPress={() => openChip(o, dateKey)}>
            {o.kind === "event" ? <EventChip occ={o} /> : <TaskChip occ={o} />}
          </Pressable>
        ))}
        {overflow ? (
          // Two chips, then "+3" in the third slot, as Apple Calendar does.
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.more, { color: colors.label2, fontSize: metrics.chipText, lineHeight: metrics.chipHeight }]}>
            +{overflow}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** "Wednesday, September 23" for VoiceOver, as Apple Calendar reads its days. */
function spokenDate(key: DateKey): string {
  const { y, m, d } = parseKey(key);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTH_NAMES[m - 1]} ${d}`;
}

function openChip(o: TaskOccurrence | EventOccurrence, dateKey: DateKey): void {
  const { openDetail } = useSheets.getState();
  if (o.kind === "event") openDetail({ kind: "event", eventId: o.event.id, dateKey });
  else openDetail({ kind: "task", taskId: o.task.id, dateKey: o.dateKey });
  router.push("/sheet/detail");
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontWeight: "700", paddingHorizontal: 20 },
  weekdays: { flexDirection: "row", marginTop: 9, paddingBottom: 2.5 },
  weekday: { flex: 1, textAlign: "center", fontWeight: "600" },
  line: { position: "absolute", height: StyleSheet.hairlineWidth },
  label: { position: "absolute", justifyContent: "flex-end" },
  labelText: { fontWeight: "600" },
  cell: { position: "absolute", alignItems: "center" },
  number: { alignItems: "center", justifyContent: "center" },
  numberText: { fontWeight: "600" },
  chips: { position: "absolute", left: 0, right: 0, paddingHorizontal: 2 },
  more: { textAlign: "center", fontWeight: "500" },
});
