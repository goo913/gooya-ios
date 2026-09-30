import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { layoutRow } from "@shared/monthRows";
import { DAY_MS, addDaysKey, fieldsInZone, makeKey, parseKey, startOfDayMs, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { TaskRing } from "@/components/Chips";
import { DragPiece, MonthDragContext, MonthDragLayer, useMonthDrag, type MonthDragHost } from "@/components/MonthDrag";
import { mix, readableTint } from "@/lib/color";
import { MONTH_SHORT, WEEKDAY_SHORT } from "@/lib/format";
import { daysOf, useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { useFilteredPeople, useTaskColor } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { usePad } from "@/store/pad";
import { useColors, useIsDark, type Colors } from "@/theme";

// Apple Calendar's iPad month (iPadOS 27), measured at 820 points wide: a grid of the months' weeks, each month starting
// on its own row, days' numbers at the top right (18 points; the 1st says "Oct 1"), up to three lines of what is on
// the day (14 points: a colour bar or a task's ring, the title, the time at the right in gray), all-day items as tinted
// capsules, something on several days as one capsule across them, "+2 more" when there are more. The weekend columns
// are shaded; hairlines between days and weeks.

const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const NUMBER_TOP = 11;
const LINES_TOP = 36;
const LINE = 19;

interface Block {
  y: number;
  m: number;
  startCol: number;
  days: number;
  rows: number;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const BLOCKS: Block[] = [];
for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
  for (let m = 1; m <= 12; m++) {
    const startCol = weekdayOfKey(makeKey(y, m, 1));
    const days = daysInMonth(y, m);
    BLOCKS.push({ y, m, startCol, days, rows: Math.ceil((startCol + days) / 7) });
  }
}

const blockOf = (key: DateKey): number => {
  const { y, m } = parseKey(key);
  return Math.min(BLOCKS.length - 1, Math.max(0, (y - FIRST_YEAR) * 12 + m - 1));
};

/** Apple's short times: "9 AM", "8:30 PM", "Noon". */
function shortTime(ms: number): string {
  const f = fieldsInZone(ms, viewerTz);
  if (f.h === 12 && f.min === 0) return "Noon";
  const h = f.h % 12 === 0 ? 12 : f.h % 12;
  return `${h}${f.min ? `:${String(f.min).padStart(2, "0")}` : ""} ${f.h < 12 ? "AM" : "PM"}`;
}

/** The weekday names over the grid, at the right of their columns as Apple sets them. */
export function PadWeekdays({ width }: { width: number }) {
  const colors = useColors();
  const colW = width / 7;
  return (
    <View style={[styles.weekdays, { borderBottomColor: colors.separator }]}>
      {WEEKDAY_SHORT.map((d, i) => (
        <Text key={d} allowFontScaling={false} style={[styles.weekday, { width: colW, color: i === 0 || i === 6 ? colors.label2 : colors.label }]}>
          {d}
        </Text>
      ))}
    </View>
  );
}

export function PadMonth({ width, onMonth, onPickDay, onHoldDay, onOpen }: { width: number; onMonth: (y: number, m: number) => void; onPickDay: (key: DateKey) => void; onHoldDay: (key: DateKey) => void; onOpen: (o: TaskOccurrence | EventOccurrence) => void }) {
  const colors = useColors();
  const colW = width / 7;
  // Apple's rows: 110.6 points at 820 wide (117 a column), 142 at 1180: about 0.6 of a column plus 40.
  const rowH = Math.round(0.6 * colW + 40);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let o = 0;
    for (const b of BLOCKS) {
      out.push(o);
      o += b.rows * rowH;
    }
    return out;
  }, [rowH]);
  const listRef = useRef<FlatList<Block>>(null);
  const date = usePad((s) => s.date);
  const jump = usePad((s) => s.jump);
  const today = useToday();
  const people = useFilteredPeople();
  const [viewportH, setViewportH] = useState(800);
  const initial = useMemo(() => blockOf(date), [date]);
  const [range, setRange] = useState({ first: initial, last: Math.min(BLOCKS.length - 1, initial + 1) });
  // The month in the title: its 1st is "1", the next month's "Oct 1" (as Apple labels them).
  const [titleIdx, setTitleIdx] = useState(initial);
  const scrollY = useRef(0);

  // The title: the month that fills most of the screen (as Apple's does while scrolling).
  const report = useCallback(
    (y: number) => {
      let best = 0;
      let bestShown = -1;
      let first = -1;
      let last = -1;
      for (let i = 0; i < BLOCKS.length; i++) {
        const top = offsets[i];
        const bottom = top + BLOCKS[i].rows * rowH;
        if (bottom < y) continue;
        if (top > y + viewportH) break;
        const shown = Math.min(bottom, y + viewportH) - Math.max(top, y);
        if (first < 0) first = i;
        last = i;
        if (shown > bestShown) {
          bestShown = shown;
          best = i;
        }
      }
      if (first >= 0) setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
      setTitleIdx(best);
      onMonth(BLOCKS[best].y, BLOCKS[best].m);
    },
    [offsets, rowH, viewportH, onMonth],
  );
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      report(scrollY.current);
    },
    [report],
  );
  // Today, a month picked in the year, a turned iPad (the rows' height changes): the month's first row at the top.
  useEffect(() => {
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: offsets[blockOf(usePad.getState().date)], animated: false });
      report(offsets[blockOf(usePad.getState().date)]);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, rowH]);

  const windowStart = useMemo(() => startOfDayMs(makeKey(BLOCKS[range.first].y, BLOCKS[range.first].m, 1), viewerTz) - DAY_MS, [range.first]);
  const windowEnd = useMemo(() => {
    const b = BLOCKS[range.last];
    return startOfDayMs(addDaysKey(makeKey(b.y, b.m, 1), b.days), viewerTz) + DAY_MS;
  }, [range.last]);
  const byDay = useTasksByDay(windowStart, windowEnd, people, viewerTz);
  const eventsByDay = useEventsByDay(windowStart, windowEnd, people, viewerTz);

  const renderItem = useCallback(
    ({ item, index }: { item: Block; index: number }) => (
      <MonthRows block={item} titled={index === titleIdx} colW={colW} rowH={rowH} today={today} byDay={byDay} eventsByDay={eventsByDay} colors={colors} onPick={onPickDay} onHold={onHoldDay} onOpen={onOpen} />
    ),
    [titleIdx, colW, rowH, today, byDay, eventsByDay, colors, onPickDay, onHoldDay, onOpen],
  );

  // Dragging a task or schedule to another day: the days' places in the window, and scrolling near the edges.
  const box = useRef<View>(null);
  const frame = useRef({ top: 0, height: 0 });
  const geometry = useRef({ colW, rowH, offsets });
  useLayoutEffect(() => {
    geometry.current = { colW, rowH, offsets };
  }, [colW, rowH, offsets]);
  const dragHost = useMemo<MonthDragHost>(
    () => ({
      dayAt: (x, y) => {
        const g = geometry.current;
        const contentY = y - frame.current.top + scrollY.current;
        let idx = 0;
        while (idx + 1 < BLOCKS.length && g.offsets[idx + 1] <= contentY) idx++;
        const b = BLOCKS[idx];
        const col = Math.max(0, Math.min(6, Math.floor(x / g.colW)));
        const i = Math.floor((contentY - g.offsets[idx]) / g.rowH) * 7 + col - b.startCol;
        return contentY >= 0 && i >= 0 && i < b.days ? makeKey(b.y, b.m, i + 1) : null;
      },
      cellRect: (day) => {
        const g = geometry.current;
        const idx = blockOf(day);
        const pos = Number(day.slice(8, 10)) - 1 + BLOCKS[idx].startCol;
        return { x: (pos % 7) * g.colW, y: frame.current.top + g.offsets[idx] + Math.floor(pos / 7) * g.rowH - scrollY.current, w: g.colW, h: g.rowH };
      },
      scrollBy: (dy) => {
        const g = geometry.current;
        const last = BLOCKS.length - 1;
        const next = Math.max(0, Math.min(g.offsets[last] + BLOCKS[last].rows * g.rowH - frame.current.height, scrollY.current + dy));
        if (Math.abs(next - scrollY.current) < 0.5) return false;
        scrollY.current = next;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
        return true;
      },
      bounds: () => ({ top: frame.current.top, bottom: frame.current.top + frame.current.height }),
    }),
    [],
  );
  const dragging = useMonthDrag((s) => !!s.item);

  return (
    <MonthDragContext.Provider value={dragHost}>
    <View ref={box} style={styles.fill} onLayout={() => box.current?.measureInWindow((_, top, __, height) => (frame.current = { top, height }))}>
    <FlatList
      key={rowH}
      ref={listRef}
      data={BLOCKS}
      keyExtractor={(b) => `${b.y}-${b.m}`}
      renderItem={renderItem}
      getItemLayout={(_, i) => ({ length: BLOCKS[i].rows * rowH, offset: offsets[i], index: i })}
      initialScrollIndex={initial}
      onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
      onScroll={onScroll}
      scrollEventThrottle={32}
      windowSize={dragging ? 15 : 5}
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      showsVerticalScrollIndicator={false}
      style={styles.fill}
    />
    <MonthDragLayer width={colW - 10} renderGhost={(o) => <GhostLine occ={o} colors={colors} />} />
    </View>
    </MonthDragContext.Provider>
  );
}

/** What is dragged, as a capsule of its colour with its title (Apple lifts an event like this on the iPad). */
function GhostLine({ occ, colors }: { occ: TaskOccurrence | EventOccurrence; colors: Colors }) {
  const dark = useIsDark();
  const ring = useTaskColor(occ.kind === "task" ? occ.task : { owner: occ.event.owner, listId: "" });
  const c = occ.kind === "event" ? occ.event.color || colors.blue : ring;
  return (
    <View style={[styles.capsule, { marginHorizontal: 0, height: 22, backgroundColor: dark ? mix(c, "#000000", 0.3) : mix(c, "#ffffff", 0.2) }]}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.capsuleText, { color: readableTint(c, dark) }]}>
        {occ.title}
      </Text>
    </View>
  );
}

interface MonthRowsProps {
  block: Block;
  /** The month in the title. */
  titled: boolean;
  colW: number;
  rowH: number;
  today: DateKey;
  byDay: Map<DateKey, TaskOccurrence[]>;
  eventsByDay: Map<DateKey, EventOccurrence[]>;
  colors: Colors;
  onPick: (key: DateKey) => void;
  onHold: (key: DateKey) => void;
  onOpen: (o: TaskOccurrence | EventOccurrence) => void;
}

type Item = TaskOccurrence | EventOccurrence;

/** A day's order: all-day first (events before tasks), then by time. */
const byTime = (a: Item, b: Item) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.allDay && a.kind !== b.kind ? (a.kind === "event" ? -1 : 1) : a.start - b.start);

const MonthRows = memo(function MonthRows({ block, titled, colW, rowH, today, byDay, eventsByDay, colors, onPick, onHold, onOpen }: MonthRowsProps) {
  const dark = useIsDark();
  const { y, m, startCol, days, rows } = block;
  const shade = dark ? "#151515" : "#f6f6f8";
  const lines = Math.max(1, Math.floor((rowH - LINES_TOP - 4) / LINE));
  const cells: ReactElement[] = [];
  const items: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    const rowDays = Array.from({ length: 7 }, (_, c) => {
      const i = r * 7 + c - startCol;
      return i >= 0 && i < days ? makeKey(y, m, i + 1) : null;
    });
    const spans = new Map<string, { item: Item; key: string; days: DateKey[] }>();
    const singles = new Map<DateKey, { item: Item; key: string }[]>();
    rowDays.forEach((key, c) => {
      if (!key) return;
      const list: Item[] = [];
      for (const o of eventsByDay.get(key) ?? []) {
        const covered = daysOf(o);
        if (covered.length < 2) list.push(o);
        else if (!spans.has(o.key)) spans.set(o.key, { item: o, key: o.key, days: covered });
      }
      list.push(...(byDay.get(key) ?? []));
      singles.set(key, list.sort(byTime).map((o) => ({ item: o, key: o.key })));
      const count = (eventsByDay.get(key)?.length ?? 0) + (byDay.get(key)?.length ?? 0);
      cells.push(
        <DayCell key={key} dateKey={key} day={Number(key.slice(8))} month={titled ? 0 : m} left={c * colW} top={r * rowH} width={colW} height={rowH} weekend={c === 0 || c === 6} isToday={key === today} count={count} colors={colors} onPick={onPick} onHold={onHold} />,
      );
    });
    const { pieces, more } = layoutRow({ days: rowDays, spans: [...spans.values()], singles, lines });
    const top = r * rowH + LINES_TOP;
    for (const p of pieces) {
      const o = p.item;
      if (p.kind === "bar" && o.kind === "event") {
        const left = p.from * colW + (p.openStart ? 0 : 5);
        const right = (p.to + 1) * colW - (p.openEnd ? 0 : 5);
        items.push(
          <DragPiece key={`${r}:${p.key}`} item={o} onTap={() => onOpen(o)} style={[styles.piece, { top: top + p.line * LINE + 1, left, width: right - left }]}>
            <SpanCapsule occ={o} openStart={p.openStart} openEnd={p.openEnd} />
          </DragPiece>,
        );
      } else {
        items.push(
          <DragPiece key={`${r}:${p.key}`} item={o} onTap={() => onOpen(o)} style={[styles.piece, { top: top + p.line * LINE, left: p.from * colW, width: colW }]}>
            <ItemLine occ={o} colors={colors} />
          </DragPiece>,
        );
      }
    }
    for (const [c, n] of more) {
      items.push(
        <Text key={`${r}:more${c}`} pointerEvents="none" allowFontScaling={false} numberOfLines={1} style={[styles.more, styles.piece, { top: top + (lines - 1) * LINE, left: c * colW, width: colW, color: colors.label2 }]}>
          +{n} more
        </Text>,
      );
    }
  }
  return (
    <View style={{ height: rows * rowH }}>
      {/* Weekend columns shaded, lines between the days, a line over every week. */}
      <View pointerEvents="none" style={[styles.shade, { left: 0, width: colW, backgroundColor: shade }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 6 * colW, width: colW, backgroundColor: shade }]} />
      {Array.from({ length: 6 }, (_, i) => (
        <View key={`v${i}`} pointerEvents="none" style={[styles.vline, { left: (i + 1) * colW, backgroundColor: colors.separator }]} />
      ))}
      {Array.from({ length: rows }, (_, r) => (
        <View key={`h${r}`} pointerEvents="none" style={[styles.hline, { top: r * rowH, backgroundColor: colors.separator }]} />
      ))}
      {cells}
      {items}
    </View>
  );
});

/** Something on several days: one tinted capsule across them, square where it goes on into another week. */
function SpanCapsule({ occ, openStart, openEnd }: { occ: EventOccurrence; openStart: boolean; openEnd: boolean }) {
  const dark = useIsDark();
  const colors = useColors();
  const c = occ.event.color || colors.blue;
  return (
    <View
      style={[
        styles.capsule,
        { marginVertical: 0, marginHorizontal: 0, backgroundColor: dark ? mix(c, "#000000", 0.3) : mix(c, "#ffffff", 0.2) },
        openStart && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
        openEnd && { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
      ]}
    >
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.capsuleText, { color: readableTint(c, dark) }]}>
        {occ.title}
      </Text>
    </View>
  );
}

interface DayCellProps {
  dateKey: DateKey;
  day: number;
  /** The month, to name on its 1st; 0 for the month in the title. */
  month: number;
  left: number;
  top: number;
  width: number;
  height: number;
  weekend: boolean;
  isToday: boolean;
  /** How many things are on the day (for VoiceOver; they are drawn over the days, week by week). */
  count: number;
  colors: Colors;
  onPick: (key: DateKey) => void;
  onHold: (key: DateKey) => void;
}

const DayCell = memo(function DayCell({ dateKey, day, month, left, top, width, height, weekend, isToday, count, colors, onPick, onHold }: DayCellProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dateKey}
      accessibilityValue={{ text: count ? `${count} ${count === 1 ? "item" : "items"}` : "" }}
      onPress={() => onPick(dateKey)}
      onLongPress={() => onHold(dateKey)}
      delayLongPress={450}
      style={[styles.cell, { left, top, width, height }]}
    >
      <View style={[styles.number, isToday && { backgroundColor: colors.red, paddingHorizontal: 5 }]}>
        <Text allowFontScaling={false} style={[styles.numberText, { color: isToday ? "#ffffff" : weekend ? colors.label2 : colors.label, fontWeight: isToday ? "600" : "400" }]}>
          {day === 1 && month && !isToday ? `${MONTH_SHORT[month - 1]} 1` : day}
        </Text>
      </View>
    </Pressable>
  );
});

/** One line of a day: an all-day event's capsule, or a colour bar or task ring with the title and time (taps and drags are its DragPiece's). */
function ItemLine({ occ, colors }: { occ: TaskOccurrence | EventOccurrence; colors: Colors }) {
  const dark = useIsDark();
  const ring = useTaskColor(occ.kind === "task" ? occ.task : { owner: occ.event.owner, listId: "" });
  if (occ.kind === "event" && occ.allDay) {
    const c = occ.event.color || colors.blue;
    return (
      <View style={[styles.capsule, { backgroundColor: dark ? mix(c, "#000000", 0.3) : mix(c, "#ffffff", 0.2) }]}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.capsuleText, { color: readableTint(c, dark) }]}>
          {occ.title}
        </Text>
      </View>
    );
  }
  const task = occ.kind === "task";
  const done = task && occ.completed;
  return (
    <View style={styles.line}>
      {task ? <TaskRing color={ring} done={done} size={12} /> : <View style={[styles.bar, { backgroundColor: occ.event.color || colors.blue }]} />}
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.lineTitle, { color: done ? colors.label2 : colors.label }]}>
        {occ.title}
      </Text>
      {!occ.allDay ? (
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.lineTime, { color: colors.label2 }]}>
          {shortTime(occ.start)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  weekdays: { flexDirection: "row", height: 30, borderBottomWidth: StyleSheet.hairlineWidth },
  weekday: { fontSize: 17, textAlign: "right", paddingRight: 10.6, lineHeight: 26 },
  shade: { position: "absolute", top: 0, bottom: 0 },
  vline: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  hline: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  cell: { position: "absolute" },
  number: { position: "absolute", top: NUMBER_TOP - 5, right: 5.6, height: 28, minWidth: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  numberText: { fontSize: 18 },
  lines: { position: "absolute", top: LINES_TOP, left: 0, right: 0 },
  line: { height: LINE, flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 8, gap: 5 },
  bar: { width: 3, height: 14, borderRadius: 1.5 },
  lineTitle: { flex: 1, fontSize: 14, fontWeight: "500" },
  lineTime: { fontSize: 12.5 },
  capsule: { height: 17, marginVertical: 1, marginHorizontal: 5, borderRadius: 4, justifyContent: "center", paddingHorizontal: 6 },
  capsuleText: { fontSize: 14, fontWeight: "500" },
  more: { fontSize: 14, paddingLeft: 8, lineHeight: LINE },
  piece: { position: "absolute" },
});
