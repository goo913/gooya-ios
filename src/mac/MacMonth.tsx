import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { layoutRow } from "@shared/monthRows";
import { DAY_MS, addDaysKey, diffDaysKey, makeKey, startOfDayMs } from "@shared/time";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactElement } from "react";
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { DragPiece, MonthDragContext, MonthDragLayer, useMonthDrag, type MonthDragHost } from "@/components/MonthDrag";
import { MONTH_SHORT, WEEKDAY_SHORT } from "@/lib/format";
import { daysOf, useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { toggleCompleted } from "@/lib/taskOps";
import { useFilteredPeople } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { usePad } from "@/store/pad";
import { usePrefs } from "@/store/prefs";
import { NEW_MENU, itemMenuItems, newKindFrom, runItemMenu } from "./itemMenu";
import { DraftLine, LINE, MonthCapsule, MonthLine, onRing } from "./MacItems";
import { MacMenu } from "./MacMenu";
import { useMac, type Anchor } from "./state";
import { useMacColors, useWindowActive, type MacColors } from "./theme";

// Apple Calendar's month on the Mac (macOS 27), measured at 1×: the weeks run on without a break between months, six of
// them filling the window (scrolling moves a week at a time); the days of the month in the title are dark, the others
// faint, weekends greyed and their columns shaded; each day's number at its top right (16 points, "Oct 1" on a 1st),
// today's in a red circle; what is on the day under it, 18 points a line. A click chooses a day or an item; a double-click
// on a day starts a new schedule or task there (Apple's popover); a double-click on an item opens it; a click on a day's
// number shows that day. Items can be dragged to another day (Escape puts one back).

/** The weeks shown, from the one with 2015's first day to the one with 2039's last. */
const FIRST_SUNDAY: DateKey = "2014-12-28";
const WEEKS = Math.ceil(diffDaysKey(FIRST_SUNDAY, "2040-01-01") / 7);
const WEEK_INDEXES = Array.from({ length: WEEKS }, (_, i) => i);
/** Where the first line of a day's items starts under the row's top. */
const ITEMS_TOP = 30;
const NUMBER_TOP = 4;
/** Rows a window shows. */
const ROWS = 6;

export const weekOf = (key: DateKey): number => Math.max(0, Math.min(WEEKS - 1, Math.floor(diffDaysKey(FIRST_SUNDAY, key) / 7)));
const sundayOf = (week: number): DateKey => addDaysKey(FIRST_SUNDAY, week * 7);

/** The month most of the six weeks from `top` are in ("YYYY-MM"), as the title names it. */
export function monthOfWeeks(top: number): string {
  const count = new Map<string, number>();
  const start = sundayOf(top);
  for (let i = 0; i < ROWS * 7; i++) {
    const m = addDaysKey(start, i).slice(0, 7);
    count.set(m, (count.get(m) ?? 0) + 1);
  }
  let best = "";
  let most = -1;
  for (const [m, n] of count) if (n > most) [best, most] = [m, n];
  return best;
}

type Item = TaskOccurrence | EventOccurrence;

/** A day's order: all-day first (events before tasks), then by time. */
const byTime = (a: Item, b: Item) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.allDay && a.kind !== b.kind ? (a.kind === "event" ? -1 : 1) : a.start - b.start);

/** The weekdays' names over the grid, at the right of their columns, weekends grey; a line under them. */
export function MacWeekdays({ width }: { width: number }) {
  const colors = useMacColors();
  return (
    <View style={[styles.weekdays, { borderBottomColor: colors.headerLine }]}>
      {WEEKDAY_SHORT.map((d, i) => (
        <Text key={d} allowFontScaling={false} style={[styles.weekday, { width: width / 7, color: i === 0 || i === 6 ? colors.text2 : colors.text }]}>
          {d}
        </Text>
      ))}
    </View>
  );
}

export interface MacMonthActions {
  /** A day's number clicked: that day in the Day view. */
  showDay: (key: DateKey) => void;
  /** Double-click on an item: its popover. */
  openItem: (o: Item, anchor: Anchor) => void;
}

export function MacMonth({ width, onMonth, actions, apiRef }: { width: number; onMonth: (y: number, m: number) => void; actions: MacMonthActions; apiRef?: MutableRefObject<{ newAt: (day: DateKey) => void } | null> }) {
  const colors = useMacColors();
  const active = useWindowActive();
  const colW = width / 7;
  const [viewportH, setViewportH] = useState(600);
  const rowH = Math.max(64, Math.floor(viewportH / ROWS));
  const z = usePrefs((s) => s.itemZoom);
  const listRef = useRef<FlatList<number>>(null);
  const date = usePad((s) => s.date);
  const jump = usePad((s) => s.jump);
  const today = useToday();
  const people = useFilteredPeople();
  const initialTop = useMemo(() => weekOf(makeKey(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)), [date]);
  const [top, setTop] = useState(initialTop);
  const scrollY = useRef(initialTop * rowH);
  const title = monthOfWeeks(top);
  useEffect(() => onMonth(Number(title.slice(0, 4)), Number(title.slice(5, 7))), [title, onMonth]);

  // A month to show (Today, ⌘← ⌘→, a month picked in the year): its first week at the top.
  useEffect(() => {
    const t = setTimeout(() => {
      const d = usePad.getState().date;
      const week = weekOf(makeKey(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1));
      scrollY.current = week * rowH;
      listRef.current?.scrollToOffset({ offset: week * rowH, animated: false });
      setTop(week);
    }, 0);
    return () => clearTimeout(t);
  }, [jump, rowH]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      setTop(Math.max(0, Math.min(WEEKS - ROWS, Math.round(scrollY.current / rowH))));
    },
    [rowH],
  );

  // What is on the weeks shown and a few around them.
  const windowStart = useMemo(() => startOfDayMs(sundayOf(Math.max(0, top - 4)), viewerTz) - DAY_MS, [top]);
  const windowEnd = useMemo(() => startOfDayMs(sundayOf(Math.min(WEEKS, top + ROWS + 4)), viewerTz) + DAY_MS, [top]);
  const byDay = useTasksByDay(windowStart, windowEnd, people, viewerTz);
  const eventsByDay = useEventsByDay(windowStart, windowEnd, people, viewerTz);

  // Where the grid is in the window (for dragging, and for where a popover points).
  const box = useRef<View>(null);
  const frame = useRef({ x: 0, y: 0, height: 0 });
  const geometry = useRef({ colW, rowH });
  useLayoutEffect(() => {
    geometry.current = { colW, rowH };
  }, [colW, rowH]);
  const cellRect = useCallback((day: DateKey) => {
    const g = geometry.current;
    const pos = diffDaysKey(FIRST_SUNDAY, day);
    return { x: frame.current.x + (pos % 7) * g.colW, y: frame.current.y + Math.floor(pos / 7) * g.rowH - scrollY.current, w: g.colW, h: g.rowH };
  }, []);
  const dragHost = useMemo<MonthDragHost>(
    () => ({
      dayAt: (x, y) => {
        const g = geometry.current;
        const contentY = y - frame.current.y + scrollY.current;
        const col = Math.floor((x - frame.current.x) / g.colW);
        if (contentY < 0 || col < 0 || col > 6) return null;
        return addDaysKey(FIRST_SUNDAY, Math.floor(contentY / g.rowH) * 7 + col);
      },
      cellRect,
      scrollBy: (dy) => {
        const g = geometry.current;
        const next = Math.max(0, Math.min(WEEKS * g.rowH - frame.current.height, scrollY.current + dy));
        if (Math.abs(next - scrollY.current) < 0.5) return false;
        scrollY.current = next;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
        return true;
      },
      bounds: () => ({ top: frame.current.y, bottom: frame.current.y + frame.current.height }),
    }),
    [cellRect],
  );
  const dragging = useMonthDrag((s) => !!s.item);

  const draft = useMac((s) => s.draft);
  const kind = usePrefs((s) => s.newKind);
  const selected = useMac((s) => s.item);
  const lines = Math.max(1, Math.floor((rowH - ITEMS_TOP - 3) / (LINE * z)));

  /** A double-click on a day: a new item there, its popover pointing at its placeholder (the day's next line). */
  const newAt = useCallback(
    (day: DateKey) => {
      const n = (byDay.get(day)?.length ?? 0) + (eventsByDay.get(day)?.length ?? 0);
      const line = Math.min(n, lines - 1);
      const r = cellRect(day);
      useMac.getState().newItem(day, 9 * 60, { x: r.x, y: r.y + ITEMS_TOP + line * LINE * z, w: r.w, h: LINE * z });
    },
    [byDay, eventsByDay, lines, cellRect, z],
  );
  // The toolbar's + and ⌘N: a new item on the chosen day, as a double-click there makes.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { newAt };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, newAt]);
  const openItem = useCallback(
    (o: Item, line: number, from: number, to: number, week: number) => {
      const g = geometry.current;
      const x = frame.current.x + from * g.colW;
      const y = frame.current.y + week * g.rowH - scrollY.current + ITEMS_TOP + line * LINE * z;
      actions.openItem(o, { x, y, w: (to - from + 1) * g.colW, h: LINE * z });
    },
    [actions, z],
  );

  const renderItem = useCallback(
    ({ item: week }: { item: number }) => (
      <WeekRow
        week={week}
        rowH={rowH}
        colW={colW}
        month={title}
        today={today}
        byDay={byDay}
        eventsByDay={eventsByDay}
        lines={lines}
        z={z}
        colors={colors}
        active={active}
        selected={selected}
        draft={draft && draft.date >= sundayOf(week) && draft.date < sundayOf(week + 1) ? { date: draft.date, title: draft.title, kind } : null}
        onNew={newAt}
        onShowDay={actions.showDay}
        onOpen={openItem}
      />
    ),
    [rowH, colW, title, today, byDay, eventsByDay, lines, z, colors, active, selected, draft, kind, newAt, actions.showDay, openItem],
  );

  return (
    <MonthDragContext.Provider value={dragHost}>
      <View
        ref={box}
        style={styles.fill}
        onLayout={(e) => {
          setViewportH(e.nativeEvent.layout.height);
          box.current?.measureInWindow((x, y, _w, h) => (frame.current = { x, y, height: h }));
        }}
      >
        <FlatList
          key={rowH}
          ref={listRef}
          data={WEEK_INDEXES}
          keyExtractor={(w) => String(w)}
          renderItem={renderItem}
          getItemLayout={(_, i) => ({ length: rowH, offset: i * rowH, index: i })}
          initialScrollIndex={Math.min(initialTop, WEEKS - ROWS)}
          onScroll={onScroll}
          scrollEventThrottle={16}
          snapToInterval={rowH}
          decelerationRate="fast"
          windowSize={dragging ? 9 : 5}
          initialNumToRender={ROWS + 1}
          maxToRenderPerBatch={ROWS}
          showsVerticalScrollIndicator={false}
          style={styles.fill}
        />
        <MonthDragLayer width={colW - 6} renderGhost={(o) => <Ghost occ={o} z={z} />} />
      </View>
    </MonthDragContext.Provider>
  );
}

/** What is dragged: its line, chosen-looking. */
function Ghost({ occ, z }: { occ: Item; z: number }) {
  const colors = useMacColors();
  return <View style={{ backgroundColor: colors.bg, borderRadius: 4 * z }}>{occ.kind === "event" && occ.allDay ? <MonthCapsule occ={occ} z={z} selected active /> : <MonthLine occ={occ} z={z} selected active />}</View>;
}

interface WeekRowProps {
  week: number;
  rowH: number;
  colW: number;
  /** The month in the title ("YYYY-MM"): its days dark, the others faint. */
  month: string;
  today: DateKey;
  byDay: Map<DateKey, TaskOccurrence[]>;
  eventsByDay: Map<DateKey, EventOccurrence[]>;
  lines: number;
  z: number;
  colors: MacColors;
  active: boolean;
  selected: string | null;
  draft: { date: DateKey; title: string; kind: "task" | "schedule" } | null;
  onNew: (day: DateKey) => void;
  onShowDay: (day: DateKey) => void;
  onOpen: (o: Item, line: number, from: number, to: number, week: number) => void;
}

const WeekRow = memo(function WeekRow({ week, rowH, colW, month, today, byDay, eventsByDay, lines, z, colors, active, selected, draft, onNew, onShowDay, onOpen }: WeekRowProps) {
  const sunday = sundayOf(week);
  const days = Array.from({ length: 7 }, (_, c) => addDaysKey(sunday, c));
  const spans = new Map<string, { item: Item; key: string; days: DateKey[] }>();
  const singles = new Map<DateKey, { item: Item; key: string }[]>();
  for (const key of days) {
    const list: Item[] = [];
    for (const o of eventsByDay.get(key) ?? []) {
      const covered = daysOf(o);
      if (covered.length < 2) list.push(o);
      else if (!spans.has(o.key)) spans.set(o.key, { item: o, key: o.key, days: covered });
    }
    list.push(...(byDay.get(key) ?? []));
    singles.set(key, list.sort(byTime).map((o) => ({ item: o, key: o.key })));
  }
  const draftCol = draft ? days.indexOf(draft.date) : -1;
  const { pieces, more } = layoutRow({ days, spans: [...spans.values()], singles, lines: draftCol >= 0 ? lines : lines });
  const items: ReactElement[] = [];
  const used = new Array(7).fill(0);
  for (const p of pieces) {
    const o = p.item;
    for (let c = p.from; c <= p.to; c++) used[c] = Math.max(used[c], p.line + 1);
    const top = ITEMS_TOP + p.line * LINE * z;
    const isSel = selected === o.key;
    if (p.kind === "bar" && o.kind === "event") {
      const left = p.from * colW + (p.openStart ? 0 : 3);
      const right = (p.to + 1) * colW - (p.openEnd ? 0 : 3);
      items.push(
        <DragPiece key={p.key} item={o} onTap={() => useMac.getState().selectItem(o.key)} onDoubleTap={() => onOpen(o, p.line, p.from, p.to, week)} style={[styles.piece, { top, left, width: right - left }]}>
          <MonthCapsule occ={o} z={z} selected={isSel} active={active} openStart={p.openStart} openEnd={p.openEnd} />
          <MacMenu style={StyleSheet.absoluteFill} items={itemMenuItems(o)} onPick={(id) => runItemMenu(o, id, () => onOpen(o, p.line, p.from, p.to, week))} />
        </DragPiece>,
      );
    } else {
      const capsule = o.kind === "event" && o.allDay;
      items.push(
        <DragPiece
          key={p.key}
          item={o}
          // A click on a task's ring completes it (or makes it not done again), as Apple Calendar's does; elsewhere it chooses it.
          onTap={(x) => (o.kind === "task" && onRing(x, z) ? void toggleCompleted(o) : useMac.getState().selectItem(o.key))}
          onDoubleTap={(x) => (o.kind === "task" && onRing(x, z) ? undefined : onOpen(o, p.line, p.from, p.from, week))}
          style={[styles.piece, { top, left: p.from * colW + 3, width: colW - 6 }]}
        >
          {capsule && o.kind === "event" ? <MonthCapsule occ={o} z={z} selected={isSel} active={active} /> : <MonthLine occ={o} z={z} selected={isSel} active={active} />}
          <MacMenu style={StyleSheet.absoluteFill} items={itemMenuItems(o)} onPick={(id) => runItemMenu(o, id, () => onOpen(o, p.line, p.from, p.from, week))} />
        </DragPiece>,
      );
    }
  }
  for (const [c, n] of more) {
    items.push(
      <Text key={`more${c}`} pointerEvents="none" allowFontScaling={false} numberOfLines={1} style={[styles.piece, styles.more, { top: ITEMS_TOP + (lines - 1) * LINE * z, left: c * colW + 8, width: colW - 12, fontSize: 11 * z, lineHeight: LINE * z, color: colors.text2 }]}>
        {n} more
      </Text>,
    );
  }
  if (draft && draftCol >= 0) {
    const line = Math.min(used[draftCol] + (more.has(draftCol) ? 0 : 0), lines - 1);
    items.push(
      <View key="draft" pointerEvents="none" style={[styles.piece, { top: ITEMS_TOP + line * LINE * z, left: draftCol * colW + 3, width: colW - 6, zIndex: 5 }]}>
        <DraftLine kind={draft.kind} title={draft.title} z={z} active={active} />
      </View>,
    );
  }
  return (
    <View style={{ height: rowH }}>
      {days.map((key, c) => (
        <DayCell key={key} dateKey={key} left={c * colW} width={colW} height={rowH} weekend={c === 0 || c === 6} inMonth={key.startsWith(month)} isToday={key === today} colors={colors} active={active} onNew={onNew} onShowDay={onShowDay} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <View key={`v${i}`} pointerEvents="none" style={[styles.vline, { left: Math.round((i + 1) * colW), backgroundColor: colors.line }]} />
      ))}
      <View pointerEvents="none" style={[styles.hline, { backgroundColor: colors.line }]} />
      {items}
    </View>
  );
});

interface DayCellProps {
  dateKey: DateKey;
  left: number;
  width: number;
  height: number;
  weekend: boolean;
  inMonth: boolean;
  isToday: boolean;
  colors: MacColors;
  active: boolean;
  onNew: (day: DateKey) => void;
  onShowDay: (day: DateKey) => void;
}

/** A day: its shading, its number at the top right; a click chooses it (its number: shows it), a double-click makes a new item there. */
const DayCell = memo(function DayCell({ dateKey, left, width, height, weekend, inMonth, isToday, colors, active, onNew, onShowDay }: DayCellProps) {
  const day = Number(dateKey.slice(8, 10));
  const first = day === 1;
  const label = first && !isToday ? `${MONTH_SHORT[Number(dateKey.slice(5, 7)) - 1]} 1` : String(day);
  // The number's place at the top right, where a click shows the day (an estimate of its width is enough).
  const numberW = (isToday ? 24 : label.length * 9) + (first && isToday ? 34 : 0) + 14;
  const gesture = useMemo(() => {
    const single = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        if (e.y < 30 && e.x > width - numberW) onShowDay(dateKey);
        else useMac.getState().selectDay(dateKey);
      });
    const double = Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd((e) => {
        if (!(e.y < 30 && e.x > width - numberW)) onNew(dateKey);
      });
    return Gesture.Simultaneous(single, double);
  }, [dateKey, width, numberW, onNew, onShowDay]);
  const color = isToday ? "#ffffff" : !inMonth ? colors.faded : weekend ? colors.text2 : colors.text;
  return (
    <GestureDetector gesture={gesture}>
      <View accessibilityRole="button" accessibilityLabel={dateKey} style={[styles.cell, { left, width, height, backgroundColor: weekend ? colors.weekend : colors.bg }]}>
        <View style={styles.numberRow}>
          {first && isToday ? (
            <Text allowFontScaling={false} style={[styles.number, { color: inMonth ? colors.text : colors.faded, marginRight: 4 }]}>
              {MONTH_SHORT[Number(dateKey.slice(5, 7)) - 1]}
            </Text>
          ) : null}
          <View style={[styles.numberWrap, isToday && { backgroundColor: active ? colors.red : colors.inactive }]}>
            <Text allowFontScaling={false} style={[styles.number, { color }]}>
              {label}
            </Text>
          </View>
        </View>
        {/* Right-click on a day: a new schedule or task on it, as Calendar's New Event and New Reminder. */}
        <MacMenu style={StyleSheet.absoluteFill} items={NEW_MENU} onPick={(id) => newKindFrom(id) && onNew(dateKey)} />
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  weekdays: { flexDirection: "row", height: 31, borderBottomWidth: 1 },
  weekday: { fontSize: 17, textAlign: "right", paddingRight: 10, lineHeight: 25 },
  cell: { position: "absolute", top: 0 },
  numberRow: { position: "absolute", top: NUMBER_TOP, right: 6, flexDirection: "row", alignItems: "center" },
  numberWrap: { minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  number: { fontSize: 16, fontVariant: ["tabular-nums"] },
  vline: { position: "absolute", top: 0, bottom: 0, width: 1 },
  hline: { position: "absolute", top: 0, left: 0, right: 0, height: 1 },
  piece: { position: "absolute" },
  more: {},
});
