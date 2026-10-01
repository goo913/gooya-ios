import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { DAY_MS, addDaysKey, makeKey, parseKey, startOfDayMs, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layoutRow } from "@shared/monthRows";
import { dominantMonth } from "@shared/visibleMonth";
import { EventBar, EventChip, TaskChip } from "@/components/Chips";
import { DragPiece, MonthDragContext, MonthDragLayer, useMonthDrag, type MonthDragHost } from "@/components/MonthDrag";
import { MONTH_NAMES, MONTH_SHORT, WEEKDAY_LETTERS } from "@/lib/format";
import { daysOf, useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { useFilteredPeople } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useSheets } from "@/store/sheets";
import { router } from "expo-router";
import { usePrefs } from "@/store/prefs";
import { ListView } from "./ListView";
import { useColors, type Colors } from "@/theme";
import { RULE } from "@/lib/layout";

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
  /** Each block's weeks' height (the block without the next month's name). */
  weeks: number[];
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
  const weeks: number[] = [];
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
      weeks.push(rows * rowH);
      offset += height;
    }
  }
  const layout = { rowH, labelH, blocks, offsets, weeks };
  layouts.set(cacheKey, layout);
  return layout;
}

function blockIndexFor(monthKey: DateKey, layout: MonthLayout): number {
  const { y, m } = parseKey(monthKey);
  return Math.min(layout.blocks.length - 1, Math.max(0, (y - FIRST_YEAR) * 12 + (m - 1)));
}

/** The month in the title: the one whose weeks fill most of the list's height in view (shared/visibleMonth.ts). */
function titleIndexForScroll(scrollTop: number, viewH: number, layout: MonthLayout): number {
  return dominantMonth(layout.offsets, layout.weeks, scrollTop, scrollTop + viewH);
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
  // Where the months are in the window and how far they are scrolled, for dragging a chip to another day.
  const scrollY = useRef(0);
  const listBox = useRef<View>(null);
  const listFrame = useRef({ top: 0, height: 0 });
  const widthRef = useRef(width);
  useLayoutEffect(() => {
    widthRef.current = width;
  }, [width]);
  const dragHost = useMemo<MonthDragHost>(() => {
    const blockAt = (contentY: number) => {
      const { offsets } = layoutRef.current;
      let lo = 0;
      let hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= contentY) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    return {
      dayAt: (x, y) => {
        const l = layoutRef.current;
        const contentY = y - listFrame.current.top + scrollY.current;
        const idx = blockAt(contentY);
        const b = l.blocks[idx];
        const inBlock = contentY - l.offsets[idx];
        // The next month's name under the rows is no day.
        if (inBlock < 0 || inBlock >= b.rows * l.rowH) return null;
        const col = Math.max(0, Math.min(6, Math.floor(x / (widthRef.current / 7))));
        const i = Math.floor(inBlock / l.rowH) * 7 + col - b.startCol;
        return i >= 0 && i < b.days ? makeKey(b.y, b.m, i + 1) : null;
      },
      cellRect: (day) => {
        const l = layoutRef.current;
        const idx = blockIndexFor(`${day.slice(0, 7)}-01`, l);
        const b = l.blocks[idx];
        const pos = Number(day.slice(8, 10)) - 1 + b.startCol;
        const colW = widthRef.current / 7;
        return { x: (pos % 7) * colW, y: listFrame.current.top + l.offsets[idx] + Math.floor(pos / 7) * l.rowH - scrollY.current, w: colW, h: l.rowH };
      },
      scrollBy: (dy) => {
        const l = layoutRef.current;
        const total = l.offsets[l.offsets.length - 1] + l.blocks[l.blocks.length - 1].height;
        const next = Math.max(0, Math.min(total - listFrame.current.height, scrollY.current + dy));
        if (Math.abs(next - scrollY.current) < 0.5) return false;
        scrollY.current = next;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
        return true;
      },
      bounds: () => ({ top: listFrame.current.top, bottom: listFrame.current.top + listFrame.current.height }),
    };
  }, []);
  // While something is dragged, more months stay drawn (it can be dragged far).
  const dragging = useMonthDrag((s) => !!s.item);

  // The list's height in view, for the title (until measured, about a screen's).
  const viewH = useRef(600);
  const retitle = useCallback(() => {
    const idx = titleIndexForScroll(scrollY.current, viewH.current, layoutRef.current);
    setTitleIdx((cur) => (cur === idx ? cur : idx));
  }, []);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollY.current = y;
      const aligned = layoutRef.current.offsets[shown.current];
      if (!settled.current && Math.abs(y - aligned) > 1 && Math.abs(y - aligned) < 80) settle();
      retitle();
    },
    [settle, retitle],
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
      <MonthDragContext.Provider value={dragHost}>
      <View
        ref={listBox}
        style={styles.fill}
        onLayout={(e) => {
          viewH.current = e.nativeEvent.layout.height;
          retitle();
          listBox.current?.measureInWindow((_, top, __, height) => (listFrame.current = { top, height }));
        }}
      >
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
        windowSize={dragging ? 15 : 5}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        style={styles.fill}
      />
      </View>
      <MonthDragLayer width={width / 7 - 4} renderGhost={(o) => (o.kind === "event" ? <EventChip occ={o} /> : <TaskChip occ={o} />)} />
      </MonthDragContext.Provider>
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
      const count = (byDay.get(key)?.length ?? 0) + (eventsByDay.get(key)?.length ?? 0);
      cells.push(<DayCell key={key} dateKey={key} day={day} col={c} row={r} colW={colW} rowH={rowH} metrics={metrics} isToday={key === today} count={count} colors={colors} onPick={onPick} onHold={onHold} />);
    }
  }
  // What is on the days, week by week: bars across the days of something on several, chips under them.
  const items = [];
  const lineH = metrics.chipHeight + metrics.chipGap;
  for (let r = 0; r < rows; r++) {
    const rowDays = Array.from({ length: 7 }, (_, c) => {
      const i = r * 7 + c - startCol;
      return i >= 0 && i < days ? makeKey(y, m, i + 1) : null;
    });
    const spans = new Map<string, { item: Item; key: string; days: DateKey[] }>();
    const singles = new Map<DateKey, { item: Item; key: string }[]>();
    for (const d of rowDays) {
      if (!d) continue;
      const list: { item: Item; key: string }[] = [];
      for (const o of eventsByDay.get(d) ?? []) {
        const covered = daysOf(o);
        if (covered.length < 2) list.push({ item: o, key: o.key });
        else if (!spans.has(o.key)) spans.set(o.key, { item: o, key: o.key, days: covered });
      }
      for (const o of byDay.get(d) ?? []) list.push({ item: o, key: o.key });
      singles.set(d, list);
    }
    const { pieces, more } = layoutRow({ days: rowDays, spans: [...spans.values()], singles, lines: metrics.chipsPerDay });
    const top = r * rowH + metrics.chipsTop;
    for (const p of pieces) {
      const left = p.from * colW + (p.openStart ? 0 : 2);
      const right = (p.to + 1) * colW - (p.openEnd ? 0 : 2);
      const o = p.item;
      items.push(
        // A chip or bar opens its details, as in Apple Calendar (touch and hold drags it); the rest of the day opens the day.
        <DragPiece key={`${r}:${p.key}`} item={o} onTap={() => openChip(o, rowDays[p.from]!)} style={[styles.piece, { top: top + p.line * lineH, left, width: right - left }]}>
          {p.kind === "bar" && o.kind === "event" ? <EventBar occ={o} openStart={p.openStart} openEnd={p.openEnd} /> : o.kind === "event" ? <EventChip occ={o} /> : <TaskChip occ={o} />}
        </DragPiece>,
      );
    }
    for (const [c, n] of more) {
      items.push(
        // "+3" in the day's last line, as Apple Calendar does.
        <Text key={`${r}:more${c}`} pointerEvents="none" allowFontScaling={false} numberOfLines={1} style={[styles.more, { top: top + (metrics.chipsPerDay - 1) * lineH, left: c * colW, width: colW, color: colors.label2, fontSize: metrics.chipText, lineHeight: metrics.chipHeight }]}>
          +{n}
        </Text>,
      );
    }
  }
  const next = layout.blocks[(y - FIRST_YEAR) * 12 + m] ?? null;
  return (
    <View style={{ height: block.height, width }}>
      {lines}
      {cells}
      {items}
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

type Item = TaskOccurrence | EventOccurrence;

interface DayCellProps {
  dateKey: DateKey;
  day: number;
  col: number;
  row: number;
  colW: number;
  rowH: number;
  metrics: Metrics;
  isToday: boolean;
  /** How many things are on the day (for VoiceOver; they are drawn over the days, week by week). */
  count: number;
  colors: Colors;
  onPick: (key: DateKey) => void;
  onHold?: (key: DateKey) => void;
}

const DayCell = memo(function DayCell({ dateKey, day, col, row, colW, rowH, metrics, isToday, count, colors, onPick, onHold }: DayCellProps) {
  const weekend = col === 0 || col === 6;
  const d = metrics.todayCircle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenDate(dateKey)}
      accessibilityValue={{ text: count ? `${count} ${count === 1 ? "item" : "items"}` : "" }}
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
  line: { position: "absolute", height: RULE },
  label: { position: "absolute", justifyContent: "flex-end" },
  labelText: { fontWeight: "600" },
  cell: { position: "absolute", alignItems: "center" },
  number: { alignItems: "center", justifyContent: "center" },
  numberText: { fontWeight: "600" },
  piece: { position: "absolute" },
  more: { position: "absolute", textAlign: "center", fontWeight: "500" },
});
