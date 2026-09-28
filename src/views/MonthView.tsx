import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { DAY_MS, addDaysKey, makeKey, parseKey, startOfDayMs, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventChip, TaskChip } from "@/components/Chips";
import { MONTH_NAMES, MONTH_SHORT, WEEKDAY_LETTERS } from "@/lib/format";
import { useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { useFilteredPeople } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useColors, type Colors } from "@/theme";

export const ROW_H = 130;
export const LABEL_H = 30;
/** The chrome above the grid: the pills' row, then the month title and the weekday letters. */
export const TITLE_TOP = 61;
const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const MAX_CHIPS = 3;

interface Block {
  y: number;
  m: number;
  startCol: number;
  days: number;
  rows: number;
  height: number;
  gridStartKey: DateKey;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const BLOCKS: Block[] = [];
export const BLOCK_OFFSETS: number[] = [];
{
  let offset = 0;
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    for (let m = 1; m <= 12; m++) {
      const firstKey = makeKey(y, m, 1);
      const startCol = weekdayOfKey(firstKey);
      const days = daysInMonth(y, m);
      const rows = Math.ceil((startCol + days) / 7);
      // A block is the month's rows, then the NEXT month's label ("Oct") under them, so a block starts exactly at its
      // first row: aligning to a month is aligning to its block.
      const height = rows * ROW_H + LABEL_H;
      BLOCKS.push({ y, m, startCol, days, rows, height, gridStartKey: addDaysKey(firstKey, -startCol) });
      BLOCK_OFFSETS.push(offset);
      offset += height;
    }
  }
}

export function blockIndexFor(monthKey: DateKey): number {
  const { y, m } = parseKey(monthKey);
  return Math.min(BLOCKS.length - 1, Math.max(0, (y - FIRST_YEAR) * 12 + (m - 1)));
}

function titleIndexForScroll(scrollTop: number): number {
  let lo = 0;
  let hi = BLOCKS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (BLOCK_OFFSETS[mid] - LABEL_H * 0.5 <= scrollTop) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const alignedOffset = (idx: number) => BLOCK_OFFSETS[idx];

export function MonthView({ monthKey, onPickDay }: { monthKey: DateKey; onPickDay: (key: DateKey) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Block>>(null);
  const today = useToday();
  const people = useFilteredPeople();
  const todayNonce = useNav((s) => s.todayNonce);
  const setVisibleMonth = useNav((s) => s.setVisibleMonth);
  const initialIndex = useMemo(() => blockIndexFor(monthKey), [monthKey]);
  const [titleIdx, setTitleIdx] = useState(initialIndex);
  const [range, setRange] = useState({ first: initialIndex, last: initialIndex });

  const scrollToBlock = useCallback((idx: number, animated: boolean) => {
    listRef.current?.scrollToOffset({ offset: alignedOffset(idx), animated });
  }, []);

  // A new month asked for (the year screen): align to it.
  const shown = useRef(initialIndex);
  useEffect(() => {
    if (shown.current === initialIndex) return;
    shown.current = initialIndex;
    scrollToBlock(initialIndex, false);
  }, [initialIndex, scrollToBlock]);

  useEffect(() => {
    if (todayNonce > 0) scrollToBlock(blockIndexFor(`${today.slice(0, 7)}-01`), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNonce]);

  useEffect(() => {
    const b = BLOCKS[titleIdx];
    setVisibleMonth(makeKey(b.y, b.m, 1));
  }, [titleIdx, setVisibleMonth]);

  const windowStart = useMemo(() => startOfDayMs(BLOCKS[range.first].gridStartKey, viewerTz) - DAY_MS, [range.first]);
  const windowEnd = useMemo(() => {
    const b = BLOCKS[range.last];
    return startOfDayMs(addDaysKey(b.gridStartKey, b.rows * 7), viewerTz) + DAY_MS;
  }, [range.last]);
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
      if (!settled.current && Math.abs(y - alignedOffset(shown.current)) > 1 && Math.abs(y - alignedOffset(shown.current)) < 80) settle();
      const idx = titleIndexForScroll(y);
      setTitleIdx((cur) => (cur === idx ? cur : idx));
    },
    [settle],
  );
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Block>[] }) => {
    if (!viewableItems.length) return;
    const idxs = viewableItems.map((v) => v.index ?? 0);
    setRange((r) => {
      const first = Math.min(...idxs);
      const last = Math.max(...idxs);
      return r.first === first && r.last === last ? r : { first, last };
    });
  }).current;

  const title = BLOCKS[titleIdx];
  const renderItem = useCallback(
    ({ item }: { item: Block }) => <MonthBlock block={item} width={width} today={today} byDay={byDay} eventsByDay={eventsByDay} colors={colors} onPick={onPickDay} />,
    [width, today, byDay, eventsByDay, colors, onPickDay],
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + TITLE_TOP, borderBottomColor: colors.separator }]}>
        <Text style={[styles.title, { color: colors.label }]}>{MONTH_NAMES[title.m - 1]}</Text>
        <View style={styles.weekdays}>
          {WEEKDAY_LETTERS.map((l, i) => (
            <Text key={i} style={[styles.weekday, { color: colors.label2 }]}>
              {l}
            </Text>
          ))}
        </View>
      </View>
      <FlatList
        ref={listRef}
        data={BLOCKS}
        keyExtractor={(b) => `${b.y}-${b.m}`}
        renderItem={renderItem}
        getItemLayout={(_, i) => ({ length: BLOCKS[i].height, offset: BLOCK_OFFSETS[i], index: i })}
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
    </View>
  );
}

interface MonthBlockProps {
  block: Block;
  width: number;
  today: DateKey;
  byDay: Map<DateKey, TaskOccurrence[]>;
  eventsByDay: Map<DateKey, EventOccurrence[]>;
  colors: Colors;
  onPick: (key: DateKey) => void;
}

const MonthBlock = memo(function MonthBlock({ block, width, today, byDay, eventsByDay, colors, onPick }: MonthBlockProps) {
  const { y, m, startCol, days, rows } = block;
  const colW = width / 7;
  const lastCol = (startCol + days - 1) % 7;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const left = r === 0 ? startCol * colW : 0;
    const right = r === rows - 1 ? (6 - lastCol) * colW : 0;
    lines.push(<View key={`l${r}`} style={[styles.line, { top: r * ROW_H, left, right, backgroundColor: colors.separator }]} />);
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const dayIndex = r * 7 + c - startCol;
      if (dayIndex < 0 || dayIndex >= days) continue;
      const day = dayIndex + 1;
      const key = makeKey(y, m, day);
      cells.push(<DayCell key={key} dateKey={key} day={day} col={c} row={r} colW={colW} isToday={key === today} occurrences={byDay.get(key)} events={eventsByDay.get(key)} colors={colors} onPick={onPick} />);
    }
  }
  const next = BLOCKS[(y - FIRST_YEAR) * 12 + m] ?? null;
  return (
    <View style={{ height: block.height, width }}>
      {lines}
      {cells}
      {next ? (
        <View style={[styles.label, { left: next.startCol * colW + 8, top: rows * ROW_H, height: LABEL_H - 1 }]}>
          <Text style={[styles.labelText, { color: colors.label }]}>{MONTH_SHORT[next.m - 1]}</Text>
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
  isToday: boolean;
  occurrences?: TaskOccurrence[];
  events?: EventOccurrence[];
  colors: Colors;
  onPick: (key: DateKey) => void;
}

const DayCell = memo(function DayCell({ dateKey, day, col, row, colW, isToday, occurrences, events, colors, onPick }: DayCellProps) {
  const weekend = col === 0 || col === 6;
  const list: (TaskOccurrence | EventOccurrence)[] = [...(events ?? []), ...(occurrences ?? [])];
  const overflow = list.length > MAX_CHIPS ? list.length - (MAX_CHIPS - 1) : 0;
  const visible = overflow ? list.slice(0, MAX_CHIPS - 1) : list;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={dateKey} onPress={() => onPick(dateKey)} style={[styles.cell, { left: col * colW, width: colW, top: row * ROW_H }]}>
      <View style={[styles.number, isToday && { backgroundColor: colors.red }]}>
        <Text style={[styles.numberText, { color: isToday ? "#ffffff" : weekend ? colors.gray : colors.label }, isToday && styles.numberToday]}>{day}</Text>
      </View>
      <View style={styles.chips}>
        {visible.map((o) => (o.kind === "event" ? <EventChip key={o.key} occ={o} /> : <TaskChip key={o.key} occ={o} />))}
        {overflow ? <Text style={[styles.more, { color: colors.label2 }]}>+{overflow} more</Text> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3, paddingHorizontal: 16 },
  weekdays: { flexDirection: "row", marginTop: 5, paddingBottom: 3 },
  weekday: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: "600" },
  line: { position: "absolute", height: StyleSheet.hairlineWidth },
  label: { position: "absolute", justifyContent: "flex-end" },
  labelText: { fontSize: 26, fontWeight: "600", lineHeight: 28 },
  cell: { position: "absolute", height: ROW_H, alignItems: "center" },
  number: { marginTop: 8, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  numberText: { fontSize: 24, fontWeight: "400" },
  numberToday: { fontWeight: "600" },
  chips: { marginTop: 9, width: "100%", gap: 4, paddingHorizontal: 2.5 },
  more: { paddingLeft: 4, fontSize: 11, fontWeight: "500", lineHeight: 14 },
});
