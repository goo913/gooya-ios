import type { DateKey, EventOccurrence, RoutineOccurrence, TaskOccurrence } from "@shared/model";
import { otherPerson, type PersonKey } from "@shared/people";
import { splitByDay } from "@shared/recurrence";
import { DAY_MS, addDaysKey, fieldsInZone, formatHHmm, minutesSinceMidnight, startOfDayMs, weekdayOfKey, zonedMs } from "@shared/time";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventBar, EventChip, TaskChip, TaskRing } from "@/components/Chips";
import { layoutRow } from "@shared/monthRows";
import { mix, readableTint, tintText } from "@/lib/color";
import { MONTH_SHORT, WEEKDAY_LETTERS, WEEKDAY_LONG, WEEKDAY_SHORT, formatColumnHeader, formatHM, formatTime, hourLabel, tzAbbrev } from "@/lib/format";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { daysOf, useEventOccurrences, useRoutineOccurrences, useTaskOccurrences } from "@/lib/occurrences";
import { colorHex, useMe, usePerson, useTaskColor, type PersonInfo } from "@/lib/people";
import { deleteRoutineDay, endRoutineBefore } from "@/lib/routineOps";
import { deleteTaskScope, setCompleted } from "@/lib/taskOps";
import { canMove, chooseFrom, moveEventByDays, moveEventTo, moveTaskByDays, moveTaskTo } from "@/lib/moves";
import { useNow, useToday, viewerTz } from "@/lib/useNow";
import { deleteRoutine } from "@/lib/db";
import { useNav } from "@/store/nav";
import { usePrefs } from "@/store/prefs";
import { useColors, useIsDark, type Colors } from "@/theme";

/** A task occupies half an hour in the timeline, from its due time, as Apple Calendar draws a scheduled reminder. */
const TASK_MINUTES = 30;

interface Seg<T> {
  occ: T;
  key: string;
  start: number;
  end: number;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

interface ColumnData {
  timed: Seg<TaskOccurrence>[];
  allDay: TaskOccurrence[];
  routines: Seg<RoutineOccurrence>[];
  events: Seg<EventOccurrence>[];
  allDayEvents: EventOccurrence[];
}

export interface DayActions {
  openTask: (occ: TaskOccurrence) => void;
  openRoutine: (occ: RoutineOccurrence) => void;
  openEvent: (occ: EventOccurrence) => void;
  editTask: (occ: TaskOccurrence) => void;
  editRoutine: (occ: RoutineOccurrence, dayOnly: boolean) => void;
  createTask: (date: DateKey, person: PersonKey, minutes: number) => void;
}

function assignLanes<T>(segs: Seg<T>[]): void {
  segs.sort((a, b) => a.startMin - b.startMin || b.endMin - b.startMin - (a.endMin - a.startMin));
  let cluster: Seg<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const s of cluster) s.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };
  for (const s of segs) {
    if (cluster.length && s.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= s.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endMin);
    } else laneEnds[lane] = s.endMin;
    s.lane = lane;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.endMin);
  }
  flush();
}

const colKey = (date: DateKey, person: PersonKey): string => `${date}|${person}`;

/** "Tuesday – Sep 29, 2026", the one-day title Apple shows under the week. */
function formatDayTitle(key: DateKey): string {
  const [y, mo, d] = key.split("-").map(Number);
  return `${WEEKDAY_LONG[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} – ${MONTH_SHORT[mo - 1]} ${d}, ${y}`;
}

/**
 * The columns: one per day and person, or one per day with everyone's items (`merged`, the iPad's week). Routines only
 * where one person's column is: across a merged column they would cover each other.
 */
function buildColumns(dates: DateKey[], people: PersonKey[], tasks: TaskOccurrence[], routines: RoutineOccurrence[], events: EventOccurrence[], merged = false): Map<string, ColumnData> {
  const map = new Map<string, ColumnData>();
  const colPeople = merged ? people.slice(0, 1) : people;
  for (const d of dates) for (const p of colPeople) map.set(colKey(d, p), { timed: [], allDay: [], routines: [], events: [], allDayEvents: [] });
  const dateSet = new Set(dates);
  /** The column an item of `owner` goes into on `date`. */
  const place = (date: DateKey, owner: PersonKey) => colKey(date, merged ? colPeople[0] : owner);
  if (merged && people.length > 1) routines = [];
  for (const occ of tasks) {
    if (!people.includes(occ.task.owner)) continue;
    if (occ.allDay) {
      if (dateSet.has(occ.dueDate)) map.get(place(occ.dueDate, occ.task.owner))!.allDay.push(occ);
      continue;
    }
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      map.get(place(s.dateKey, occ.task.owner))!.timed.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin: Math.min(24 * 60, s.startMin + TASK_MINUTES), lane: 0, lanes: 1 });
    }
  }
  for (const occ of routines) {
    if (!people.includes(occ.routine.owner)) continue;
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      map.get(place(s.dateKey, occ.routine.owner))!.routines.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin: s.endMin, lane: 0, lanes: 1 });
    }
  }
  for (const occ of events) {
    if (!people.includes(occ.event.owner)) continue;
    if (occ.allDay) {
      for (const d of dates) if (occ.startDate <= d && d <= occ.endDate) map.get(place(d, occ.event.owner))!.allDayEvents.push(occ);
      continue;
    }
    // A day or longer (Sep 30, 7 PM to Oct 3): with the all-day ones at the top, as Apple Calendar shows it, instead of
    // filling whole days of the timeline.
    if (occ.end - occ.start >= DAY_MS) {
      for (const d of daysOf(occ)) if (dateSet.has(d)) map.get(place(d, occ.event.owner))!.allDayEvents.push(occ);
      continue;
    }
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      // A schedule without an end time takes the room of a task (half an hour), so what follows does not cover it.
      const endMin = occ.end > occ.start ? Math.max(s.endMin, s.startMin + 1) : Math.min(24 * 60, s.startMin + TASK_MINUTES);
      map.get(place(s.dateKey, occ.event.owner))!.events.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin, lane: 0, lanes: 1 });
    }
  }
  for (const c of map.values()) {
    // Tasks and events share the columns: overlapping ones sit side by side, as in Apple Calendar.
    assignLanes<TaskOccurrence | EventOccurrence>([...c.timed, ...c.events] as Seg<TaskOccurrence | EventOccurrence>[]);
    c.allDay.sort((a, b) => a.title.localeCompare(b.title));
    c.routines.sort((a, b) => a.startMin - b.startMin);
  }
  return map;
}

const snapFor = (hourH: number): number => (hourH >= 110 ? 5 : 15);

const sheet = chooseFrom;

/** How near the view's left or right edge a dragged item must be held to move a day back or on. */
const EDGE = 28;

/**
 * Holding something dragged at the view's left or right edge moves it a day back or on, and another day every 0.7 s it
 * stays there (as Apple Calendar turns the page): `shift` days in all.
 */
function useEdgeShift(edges: { current: { left: number; right: number } }) {
  const [shift, setShift] = useState(0);
  const shiftRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const side = useRef(0);
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    side.current = 0;
  }, []);
  const track = useCallback(
    (x: number) => {
      const e = edges.current;
      const s = x < e.left + EDGE ? -1 : x > e.right - EDGE ? 1 : 0;
      if (s === side.current) return;
      stop();
      side.current = s;
      if (!s) return;
      timer.current = setInterval(() => {
        shiftRef.current += s;
        setShift(shiftRef.current);
        void Haptics.selectionAsync();
      }, 700);
    },
    [edges, stop],
  );
  const reset = useCallback(() => {
    stop();
    shiftRef.current = 0;
    setShift(0);
  }, [stop]);
  useEffect(() => stop, [stop]);
  return { shift, shiftRef, track, reset };
}

/** "Thu, Oct 1" for a dragged item's new day. */
function shortDay(key: DateKey): string {
  return `${WEEKDAY_SHORT[weekdayOfKey(key)]}, ${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;
}

export interface DayViewProps {
  dateKey: DateKey;
  onChangeDate: (k: DateKey) => void;
  actions: DayActions;
  /** The view's width (the iPad's day pane); the window's by default. */
  width?: number;
  /** Days side by side (7 for the iPad's week); the person's Single Day / Multi Day by default. */
  days?: number;
  /** One column per day with both people's items (the iPad's week) instead of a column per person. */
  merged?: boolean;
  /** The phone's room for the bar above and its week strip; the iPad draws its own above the view. */
  chrome?: boolean;
  /** The item open in the iPad's details pane, drawn as selected. */
  selectedKey?: string | null;
  /** Apple's iPad proportions: 65-point hours (50 on the iPhone) and a 93-point column of hours. */
  pad?: boolean;
}

export function DayView({ dateKey, onChangeDate, actions, width: paneWidth, days: daysProp, merged = false, chrome = true, selectedKey = null, pad = false }: DayViewProps) {
  const colors = useColors();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const width = paneWidth ?? window.width;
  const me = useMe();
  const other = otherPerson(me);
  const m = useMetrics();
  const timelineDays = usePrefs((s) => s.timelineDays);
  const timelinePeople = usePrefs((s) => s.timelinePeople);
  // The zoom is stored at the default Text Size; Apple's hour grows with Text Size (50 points, 61.7 two steps up).
  const hourBase = usePrefs((s) => s.hourHeight);
  // The pinch zoom is kept for the default Text Size on a phone; the iPad's hours are 1.3 times the phone's.
  const zoomScale = m.fontScale * (pad ? 1.3 : 1);
  const hourH = Math.min(260, Math.max(20, hourBase * zoomScale));
  const setHourHeight = usePrefs((s) => s.setHourHeight);
  const meInfo = usePerson(me);
  const otherInfo = usePerson(other);
  const infos: Record<PersonKey, PersonInfo> = me === "gooya" ? { gooya: meInfo, eunbi: otherInfo } : { gooya: otherInfo, eunbi: meInfo };
  const secondGutter = meInfo.settings.secondGutter;
  const intensity = meInfo.settings.routineIntensity ?? (dark ? 0.5 : 0.35);
  const days = daysProp ?? timelineDays;
  const people = useMemo<PersonKey[]>(() => (timelinePeople === "me" ? [me] : timelinePeople === "other" ? [other] : [me, other]), [timelinePeople, me, other]);
  // The columns' people: each person, or the first standing for everyone in a merged week.
  const colPeople = useMemo(() => (merged ? people.slice(0, 1) : people), [merged, people]);
  const todayNonce = useNav((s) => s.todayNonce);
  const today = useToday();
  const now = useNow(30_000);

  const pageDates = useMemo(() => [-1, 0, 1].map((p) => Array.from({ length: days }, (_, i) => addDaysKey(dateKey, p * days + i))), [dateKey, days]);
  const allDates = useMemo(() => pageDates.flat(), [pageDates]);
  const rangeStart = useMemo(() => startOfDayMs(allDates[0], viewerTz) - DAY_MS, [allDates]);
  const rangeEnd = useMemo(() => startOfDayMs(addDaysKey(allDates[allDates.length - 1], 1), viewerTz) + DAY_MS, [allDates]);
  const taskOcc = useTaskOccurrences(rangeStart, rangeEnd, people);
  const schedOcc = useRoutineOccurrences(rangeStart, rangeEnd, people);
  const eventOcc = useEventOccurrences(rangeStart, rangeEnd, people);
  const columns = useMemo(() => buildColumns(allDates, people, taskOcc, schedOcc, eventOcc, merged), [allDates, people, taskOcc, schedOcc, eventOcc, merged]);
  // Days side by side in one column each (the iPad's week, or one person's days): something on several of them is one
  // bar across them at the top, as in the month; with a column per person, each day has its own chips.
  const spanning = days > 1 && colPeople.length === 1;
  const spanLayouts = useMemo(() => {
    if (!spanning) return null;
    return pageDates.map((dates) => {
      const spans = new Map<string, { item: TaskOccurrence | EventOccurrence; key: string; days: DateKey[] }>();
      const singles = new Map<DateKey, { item: TaskOccurrence | EventOccurrence; key: string }[]>();
      for (const d of dates) {
        const c = columns.get(colKey(d, colPeople[0]));
        const list: { item: TaskOccurrence | EventOccurrence; key: string }[] = [];
        for (const o of c?.allDayEvents ?? []) {
          const covered = daysOf(o);
          if (covered.length < 2) list.push({ item: o, key: o.key });
          else if (!spans.has(o.key)) spans.set(o.key, { item: o, key: o.key, days: covered });
        }
        for (const o of c?.allDay ?? []) list.push({ item: o, key: o.key });
        singles.set(d, list);
      }
      return layoutRow({ days: dates, spans: [...spans.values()], singles, lines: 2 });
    });
  }, [spanning, pageDates, columns, colPeople]);
  const allDayRows = useMemo(() => {
    if (spanLayouts) {
      const { pieces, more } = spanLayouts[1];
      return Math.min(2, Math.max(0, ...pieces.map((x) => x.line + 1), more.size ? 2 : 0));
    }
    let max = 0;
    for (const d of pageDates[1]) for (const p of colPeople) {
      const c = columns.get(colKey(d, p));
      max = Math.max(max, Math.min(2, (c?.allDay.length ?? 0) + (c?.allDayEvents.length ?? 0)));
    }
    return max;
  }, [spanLayouts, columns, pageDates, colPeople]);

  const gutterW = (pad ? 93 : m.gutter) + (secondGutter ? 32 * m.day : 0);
  const pageW = width - gutterW;
  const titleH = m.dayTitle * 1.34;
  const namesH = colPeople.length > 1 ? m.personName * 1.3 : 0;
  const allDayTop = 7 + titleH + namesH + 2;
  const allDayRowH = m.chipHeight + 3;
  const headerH = Math.max(m.dayTitleBand, allDayTop + 3) + (allDayRows ? allDayRows * allDayRowH + 4 : 0);
  const scrollRef = useRef<ScrollView>(null);
  const pagerRef = useRef<ScrollView>(null);
  const headerPagerRef = useRef<ScrollView>(null);
  const nowMin = minutesSinceMidnight(now, viewerTz);
  const centerHasToday = pageDates[1].includes(today);
  const hourHRef = useRef(hourH);
  useEffect(() => {
    hourHRef.current = hourH;
  }, [hourH]);
  const scrollTop = useRef(0);
  const fontScaleRef = useRef(zoomScale);
  useEffect(() => {
    fontScaleRef.current = zoomScale;
  }, [zoomScale]);

  const scrollToMinutes = useCallback((min: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, (min / 60) * hourHRef.current), animated });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => scrollToMinutes(centerHasToday ? nowMin - 110 : 8 * 60 - 20, false), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (todayNonce > 0) scrollToMinutes(nowMin - 110, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNonce]);

  // The three pages (yesterday · today · tomorrow) sit in a paging scroll view that is put back on the middle page
  // after every swipe, with the dates moved on: swiping never runs out of days.
  const recenter = useCallback(() => {
    pagerRef.current?.scrollTo({ x: pageW, animated: false });
    headerPagerRef.current?.scrollTo({ x: pageW, animated: false });
  }, [pageW]);
  useEffect(recenter, [recenter, dateKey]);
  const onPageEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / pageW);
    if (page === 1) return;
    onChangeDate(addDaysKey(dateKey, (page - 1) * days));
  };
  const syncHeader = (e: NativeSyntheticEvent<NativeScrollEvent>) => headerPagerRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });

  // Pinch to zoom the hour height, keeping the time under the fingers fixed.
  const pinchMemo = useRef<{ h0: number; top0: number; oy: number } | null>(null);
  const onPinchStart = useCallback((e: { focalY: number }) => {
    pinchMemo.current = { h0: hourHRef.current, top0: scrollTop.current, oy: e.focalY };
  }, []);
  const onPinchUpdate = useCallback(
    (e: { scale: number }) => {
      const m = pinchMemo.current;
      if (!m) return;
      const newH = Math.min(240, Math.max(24, m.h0 * e.scale));
      setHourHeight(newH / fontScaleRef.current);
      scrollRef.current?.scrollTo({ y: ((m.top0 + m.oy) / m.h0) * newH - m.oy, animated: false });
    },
    [setHourHeight],
  );
  // The handlers read refs, which is fine: the gesture system calls them while a finger moves, never during render.
  // eslint-disable-next-line react-hooks/refs
  const pinch = useMemo(() => Gesture.Pinch().runOnJS(true).onStart(onPinchStart).onUpdate(onPinchUpdate), [onPinchStart, onPinchUpdate]);

  const routineMenu = useCallback(
    (occ: RoutineOccurrence) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      sheet([
        { label: "Edit This Day Only", onSelect: () => actions.editRoutine(occ, true) },
        { label: "Edit Routine…", onSelect: () => actions.editRoutine(occ, false) },
        { label: "Delete This Day Only", destructive: true, onSelect: () => void deleteRoutineDay(occ.routine, occ.dateKey) },
        { label: "Delete All Future", destructive: true, onSelect: () => void endRoutineBefore(occ.routine, occ.dateKey) },
        { label: "Delete Routine", destructive: true, onSelect: () => void deleteRoutine(occ.routine.id) },
      ]);
    },
    [actions],
  );
  const taskMenu = useCallback(
    (occ: TaskOccurrence) => {
      const task = occ.task;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const deletes = task.rrule
        ? [
            { label: "Delete This Task Only", destructive: true, onSelect: () => void deleteTaskScope(task, occ, "this") },
            { label: "Delete All Future Tasks", destructive: true, onSelect: () => void deleteTaskScope(task, occ, "future") },
            { label: "Delete All Tasks", destructive: true, onSelect: () => void deleteTaskScope(task, occ, "all") },
          ]
        : [{ label: task.source === "apple-reminders" ? "Delete Reminder" : "Delete Task", destructive: true, onSelect: () => void deleteTaskScope(task, occ, "all") }];
      sheet([
        { label: occ.completed ? "Mark Incomplete" : "Mark Complete", onSelect: () => void setCompleted(task, occ.dateKey, !occ.completed) },
        { label: "Details", onSelect: () => actions.editTask(occ) },
        ...deletes,
      ]);
    },
    [actions],
  );
  // A task dragged to a time (and maybe another day or person's column): kept on its owner's clock (src/lib/moves.ts).
  const commitMove = useCallback((seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => {
    moveTaskTo(seg.occ, date, formatHHmm(Math.floor(startMin / 60), startMin % 60), person);
  }, []);

  // A schedule dragged to another time or day: GOOYA's own, or an event of a two-way calendar (the change goes to
  // Google or iCloud).
  const commitEventMove = useCallback((seg: Seg<EventOccurrence>, startMin: number, date: DateKey) => {
    moveEventTo(seg.occ, zonedMs(date, formatHHmm(Math.floor(startMin / 60), startMin % 60), viewerTz));
  }, []);

  // The view's left and right edges in the window: holding a dragged item there moves it a day back or on, and the
  // view follows it there when it is let go.
  const root = useRef<View>(null);
  const edges = useRef({ left: 0, right: window.width });
  const onShift = useCallback((days: number) => onChangeDate(addDaysKey(dateKey, days)), [onChangeDate, dateKey]);

  const hours = Array.from({ length: 24 }, (_, i) => i + 1);
  const secondaryLabels = useMemo(() => {
    if (!secondGutter) return null;
    const base = pageDates[1][0];
    return hours.map((h) => {
      const f = fieldsInZone(zonedMs(base, `${String(h % 24).padStart(2, "0")}:00`, viewerTz) + (h === 24 ? DAY_MS : 0), otherInfo.timezone);
      const l = hourLabel(f.h);
      return { num: f.min ? `${l.num}:${String(f.min).padStart(2, "0")}` : l.num, suffix: l.suffix };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondGutter, pageDates, otherInfo.timezone]);

  const subW = pageW / days / colPeople.length;
  const subCols = useMemo(() => pageDates[1].flatMap((d) => colPeople.map((p) => ({ date: d, person: p }))), [pageDates, colPeople]);
  // In a merged week a task dragged to another day stays its owner's (the column stands for both people).
  const onMoveTask = useCallback(
    (seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => commitMove(seg, startMin, date, merged ? seg.occ.task.owner : person),
    [commitMove, merged],
  );

  return (
    <View ref={root} style={[styles.fill, { backgroundColor: colors.bg }]} onLayout={() => root.current?.measureInWindow((x, _y, w) => (edges.current = { left: x, right: x + w }))}>
      <View style={{ backgroundColor: colors.bar }}>
      {chrome ? (
        <>
          <View style={{ height: insets.top + m.barHeight }} />
          <WeekStrip anchor={dateKey} days={days} today={today} width={width} colors={colors} metrics={m} onPick={onChangeDate} />
        </>
      ) : null}

      {/* Column headers (+ all-day strip) */}
      <View style={[styles.header, { height: headerH, borderBottomColor: colors.separator }]}>
        <View style={{ width: gutterW }}>
          {secondGutter ? (
            <View style={[styles.tzRow, { top: 7 + (titleH - m.personName * 1.3) / 2 }]}>
              <Text allowFontScaling={false} style={[styles.tz, { color: colors.label3, fontSize: m.personName * 0.95 }]}>{tzAbbrev(otherInfo.timezone, now)}</Text>
              <Text allowFontScaling={false} style={[styles.tz, { color: colors.label3, fontSize: m.personName * 0.95 }]}>{tzAbbrev(viewerTz, now)}</Text>
            </View>
          ) : null}
          {allDayRows ? (
            <Text allowFontScaling={false} style={[styles.allDayLabel, { color: colors.label2, top: allDayTop + (allDayRowH - m.chipText * 1.3) / 2, fontSize: m.chipText }]}>
              all-day
            </Text>
          ) : null}
        </View>
        <ScrollView ref={headerPagerRef} horizontal pagingEnabled scrollEnabled={false} showsHorizontalScrollIndicator={false} contentOffset={{ x: pageW, y: 0 }} style={{ width: pageW }}>
          {pageDates.map((dates, p) => (
            <View key={p} style={{ width: pageW, flexDirection: "row" }}>
              {dates.map((date, di) => (
                <View key={date} style={[styles.dateCol, di > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.separator }]}>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[
                      styles.dateTitle,
                      { color: date === today && days > 1 ? colors.red : colors.label, fontSize: m.dayTitle, lineHeight: titleH, marginTop: people.length > 1 || allDayRows ? 7 : (m.dayTitleBand - titleH) / 2 },
                      // One day: centred on the whole screen, as Apple's title is, not on the column right of the hours.
                      days === 1 && { marginLeft: -gutterW, paddingLeft: 0 },
                    ]}
                  >
                    {days === 1 ? formatDayTitle(date) : days >= 5 ? "" : formatColumnHeader(date)}
                  </Text>
                  {days >= 5 ? <WeekColumnHeader date={date} today={today} colors={colors} top={people.length > 1 || allDayRows ? 7 : (m.dayTitleBand - titleH) / 2} height={titleH} /> : null}
                  {colPeople.length > 1 ? (
                    <View style={[styles.names, { height: namesH }]}>
                      {colPeople.map((pk) => (
                        <Text key={pk} allowFontScaling={false} numberOfLines={1} style={[styles.name, { color: colorHex(infos[pk].color, dark), fontSize: m.personName, lineHeight: namesH }]}>
                          {infos[pk].name}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {allDayRows && !spanning ? (
                    <View style={[styles.allDayRow, { top: allDayTop }]}>
                      {colPeople.map((pk) => {
                        const col = columns.get(colKey(date, pk));
                        const list: (TaskOccurrence | EventOccurrence)[] = [...(col?.allDayEvents ?? []), ...(col?.allDay ?? [])];
                        const overflow = list.length > 2 ? list.length - 1 : 0;
                        const visible = overflow ? list.slice(0, 1) : list;
                        return (
                          <View key={pk} style={styles.allDayCol}>
                            {visible.map((o) => (
                              <AllDayChip key={o.key} occ={o} date={date} dateIndex={di} days={days} dateW={pageW / days} draggable={p === 1} edges={edges} onShift={onShift} onOpen={o.kind === "event" ? () => actions.openEvent(o) : () => actions.openTask(o)} />
                            ))}
                            {overflow ? (
                              <Text allowFontScaling={false} numberOfLines={1} style={[styles.more, { color: colors.label2, fontSize: m.chipText, lineHeight: m.chipHeight }]}>
                                +{overflow}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ))}
              {allDayRows && spanLayouts ? (
                <View style={[styles.spanLayer, { top: allDayTop, width: pageW, height: allDayRows * allDayRowH }]}>
                  {spanLayouts[p].pieces.map((x) => {
                    const dateW = pageW / days;
                    const left = x.from * dateW + (x.openStart ? 0 : 2);
                    const right = (x.to + 1) * dateW - (x.openEnd ? 0 : 2);
                    const o = x.item;
                    return (
                      <View key={x.key} style={[styles.spanPiece, { top: x.line * allDayRowH, left, width: right - left }]}>
                        <AllDayChip
                          occ={o}
                          date={dates[x.from]}
                          dateIndex={x.from}
                          days={days}
                          dateW={dateW}
                          draggable={p === 1}
                          edges={edges}
                          onShift={onShift}
                          onOpen={o.kind === "event" ? () => actions.openEvent(o) : () => actions.openTask(o)}
                          bar={x.kind === "bar" ? { openStart: x.openStart, openEnd: x.openEnd } : undefined}
                        />
                      </View>
                    );
                  })}
                  {[...spanLayouts[p].more].map(([c, n]) => (
                    <Text key={`more${c}`} pointerEvents="none" allowFontScaling={false} numberOfLines={1} style={[styles.more, styles.spanPiece, { top: allDayRowH, left: c * (pageW / days), width: pageW / days, color: colors.label2, fontSize: m.chipText, lineHeight: m.chipHeight }]}>
                      +{n}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
      </View>

      {/* Timeline */}
      <GestureDetector gesture={pinch}>
        <ScrollView ref={scrollRef} style={styles.fill} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={(e) => (scrollTop.current = e.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
          <View style={{ height: 24 * hourH + 24, flexDirection: "row" }}>
            <View style={{ width: gutterW }}>
              {hours.map((h, i) => {
                const hideNear = centerHasToday && Math.abs(h * 60 - nowMin) < 16 * (62 / hourH);
                const l = hourLabel(h);
                const rowH = m.hourNumber * 1.4;
                return (
                  <View key={h} style={[styles.hourRow, { top: h * hourH - rowH / 2, height: rowH, paddingRight: 7.3, opacity: hideNear ? 0 : 1 }]}>
                    {secondaryLabels ? (
                      <View style={styles.secondary}>
                        <Text allowFontScaling={false} style={[styles.secondaryNum, { color: colors.label3, fontSize: m.hourNumber * 0.8 }]}>{secondaryLabels[i].num}</Text>
                        <Text allowFontScaling={false} style={[styles.secondarySuffix, { color: colors.label3, fontSize: m.hourSuffix * 0.9 }]}>{secondaryLabels[i].suffix}</Text>
                      </View>
                    ) : null}
                    {h === 12 ? (
                      // Apple writes "Noon" rather than 12 PM.
                      <Text allowFontScaling={false} style={[styles.noon, { color: colors.label2, fontSize: m.noon }]}>Noon</Text>
                    ) : (
                      <>
                        <Text allowFontScaling={false} style={[styles.hourNum, { color: colors.label2, fontSize: m.hourNumber }]}>{l.num}</Text>
                        <Text allowFontScaling={false} style={[styles.hourSuffix, { color: colors.label2, fontSize: m.hourSuffix }]}>{l.suffix}</Text>
                      </>
                    )}
                  </View>
                );
              })}
              {centerHasToday ? (
                <View style={[styles.nowBadge, { backgroundColor: colors.red, top: (nowMin / 60) * hourH - m.nowHeight / 2, height: m.nowHeight, borderRadius: m.nowHeight / 2, paddingHorizontal: 5 * m.day }]}>
                  <Text allowFontScaling={false} style={[styles.nowBadgeText, { fontSize: m.nowText }]}>{formatTime(now, viewerTz).replace(/ [AP]M$/, "")}</Text>
                </View>
              ) : null}
            </View>
            <ScrollView ref={pagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: pageW, y: 0 }} onScroll={syncHeader} scrollEventThrottle={16} onMomentumScrollEnd={onPageEnd} style={{ width: pageW }} nestedScrollEnabled>
              {pageDates.map((dates, p) => (
                <View key={p} style={{ width: pageW }}>
                  {Array.from({ length: 25 }, (_, h) => (
                    <View key={h} pointerEvents="none" style={[styles.hourLine, { top: h * hourH, backgroundColor: colors.separator }]} />
                  ))}
                  <View style={{ flexDirection: "row", height: 24 * hourH }}>
                    {dates.map((date, di) => (
                      <View key={date} style={[styles.dateBody, di > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.separator }]}>
                        {colPeople.map((pk, pi) => (
                          <SubColumn
                            key={pk}
                            date={date}
                            person={pk}
                            info={infos[pk]}
                            data={columns.get(colKey(date, pk))!}
                            hourH={hourH}
                            metrics={m}
                            divider={pi > 0}
                            intensity={intensity}
                            dark={dark}
                            colors={colors}
                            subW={subW}
                            subIndex={p === 1 ? di * colPeople.length + pi : -1}
                            subCols={subCols}
                            selectedKey={selectedKey}
                            actions={actions}
                            onRoutineMenu={routineMenu}
                            onTaskMenu={taskMenu}
                            onMove={onMoveTask}
                            onMoveEvent={commitEventMove}
                            edges={edges}
                            onShift={onShift}
                          />
                        ))}
                        {date === today ? <View pointerEvents="none" style={[styles.nowLine, { backgroundColor: colors.red, top: (nowMin / 60) * hourH - 1 }]} /> : null}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      </GestureDetector>
    </View>
  );
}

interface SubColumnProps {
  date: DateKey;
  person: PersonKey;
  info: PersonInfo;
  data: ColumnData;
  hourH: number;
  metrics: Metrics;
  divider: boolean;
  intensity: number;
  dark: boolean;
  colors: Colors;
  subW: number;
  /** This column's index among the middle page's sub-columns (for drag targets), or -1 on the side pages. */
  subIndex: number;
  subCols: { date: DateKey; person: PersonKey }[];
  selectedKey: string | null;
  actions: DayActions;
  onRoutineMenu: (occ: RoutineOccurrence) => void;
  onTaskMenu: (occ: TaskOccurrence) => void;
  onMove: (seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => void;
  onMoveEvent: (seg: Seg<EventOccurrence>, startMin: number, date: DateKey) => void;
  /** The view's edges in the window (holding a dragged item there moves it a day), and showing days further on. */
  edges: { current: { left: number; right: number } };
  onShift: (days: number) => void;
}

const SubColumn = memo(function SubColumn({ date, person, info, data, hourH, metrics, divider, intensity, dark, colors, subW, subIndex, subCols, selectedKey, actions, onRoutineMenu, onTaskMenu, onMove, onMoveEvent, edges, onShift }: SubColumnProps) {
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .runOnJS(true)
        .minDuration(450)
        .onStart((e) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          actions.createTask(date, person, Math.round(((e.y / hourH) * 60) / 15) * 15);
        }),
    [actions, date, person, hourH],
  );
  return (
    <GestureDetector gesture={longPress}>
      <View style={[styles.subCol, divider && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.separator }]}>
        {data.routines.map((seg) => (
          <RoutineBand key={seg.key} seg={seg} info={info} hourH={hourH} metrics={metrics} intensity={intensity} dark={dark} colors={colors} onMenu={onRoutineMenu} onTap={actions.openRoutine} />
        ))}
        {data.events.map((seg) => (
          <EventBlock key={seg.key} seg={seg} hourH={hourH} metrics={metrics} dark={dark} colors={colors} date={date} subW={subW} subIndex={subIndex} subCols={subCols} selected={seg.occ.key === selectedKey} onTap={actions.openEvent} onMove={onMoveEvent} edges={edges} onShift={onShift} />
        ))}
        {data.timed.map((seg) => (
          <TaskPill key={seg.key} seg={seg} info={info} hourH={hourH} metrics={metrics} dark={dark} colors={colors} date={date} person={person} subW={subW} subIndex={subIndex} subCols={subCols} selected={seg.occ.key === selectedKey} onTap={actions.openTask} onMenu={onTaskMenu} onMove={onMove} edges={edges} onShift={onShift} />
        ))}
      </View>
    </GestureDetector>
  );
});

/**
 * Routine band: the person's (or the routine's own) colour mixed into the background at the chosen intensity, a
 * solid 3pt accent bar, and a bright (dark mode) or deep (light mode) tint for the title — like Apple Calendar.
 */
const RoutineBand = memo(function RoutineBand({ seg, info, hourH, metrics, intensity, dark, colors, onMenu, onTap }: { seg: Seg<RoutineOccurrence>; info: PersonInfo; hourH: number; metrics: Metrics; intensity: number; dark: boolean; colors: Colors; onMenu: (occ: RoutineOccurrence) => void; onTap: (occ: RoutineOccurrence) => void }) {
  const sleep = seg.occ.routine.kind === "sleep";
  const top = (seg.startMin / 60) * hourH;
  const height = Math.max(6, ((seg.endMin - seg.startMin) / 60) * hourH);
  const base = seg.occ.routine.color ? colorHex(seg.occ.routine.color, dark) : colorHex(info.color, dark);
  const pct = Math.min(0.95, Math.max(0.1, intensity * (sleep ? 0.8 : 1)));
  return (
    <Pressable onPress={() => onTap(seg.occ)} onLongPress={() => onMenu(seg.occ)} delayLongPress={420} style={[styles.band, { top, height, backgroundColor: mix(base, colors.bg, pct), borderLeftColor: base }]}>
      {seg.startMin > 0 || height > 30 ? (
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.bandTitle, { color: tintText(base, dark), fontSize: 11 * metrics.day, lineHeight: 13.5 * metrics.day }]}>
          {seg.occ.icon} {seg.occ.title}
        </Text>
      ) : null}
    </Pressable>
  );
});

interface EventBlockProps {
  seg: Seg<EventOccurrence>;
  hourH: number;
  metrics: Metrics;
  dark: boolean;
  colors: Colors;
  date: DateKey;
  subW: number;
  subIndex: number;
  subCols: { date: DateKey; person: PersonKey }[];
  selected: boolean;
  onTap: (occ: EventOccurrence) => void;
  onMove: (seg: Seg<EventOccurrence>, startMin: number, date: DateKey) => void;
  edges: { current: { left: number; right: number } };
  onShift: (days: number) => void;
}

/**
 * Imported event block, as Apple Calendar draws an event: its calendar's colour over the background, a rounded 3-point
 * bar inset at the left, the title in the calendar's colour, the time under it when there is room. An event of a
 * two-way calendar can be lifted with a long press and dragged to another time or day (its own person's columns).
 */
const EventBlock = memo(function EventBlock({ seg, hourH, metrics, dark, colors, date, subW, subIndex, subCols, selected, onTap, onMove, edges, onShift }: EventBlockProps) {
  const [preview, setPreview] = useState<{ startMin: number; dx: number; target: number } | null>(null);
  const edge = useEdgeShift(edges);
  const [lifted, setLifted] = useState(false);
  const previewRef = useRef<{ startMin: number; dx: number; target: number } | null>(null);
  const moved = useRef(false);
  const c = seg.occ.event.color || colors.blue;
  const snap = snapFor(hourH);
  const movable = seg.occ.event.editable && !seg.occ.allDay;
  // Columns go day by day, a column per person: the same person's column on another day is this many columns away.
  const perDay = Math.max(1, new Set(subCols.map((s) => s.person)).size);
  const showPreview = useCallback((p: { startMin: number; dx: number; target: number } | null) => {
    previewRef.current = p;
    setPreview(p);
  }, []);
  const onPanStart = useCallback(() => {
    moved.current = false;
    setLifted(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);
  const onPanUpdate = useCallback(
    (e: { translationX: number; translationY: number; absoluteX: number }) => {
      if (Math.abs(e.translationX) < 4 && Math.abs(e.translationY) < 4 && !moved.current) return;
      moved.current = true;
      edge.track(e.absoluteX);
      const deltaMin = Math.round(((e.translationY / hourH) * 60) / snap) * snap;
      const startMin = Math.min(24 * 60 - snap, Math.max(0, seg.startMin + deltaMin));
      const days = subIndex < 0 ? 0 : Math.round(e.translationX / (subW * perDay));
      const target = subIndex < 0 ? -1 : Math.max(subIndex % perDay, Math.min(subCols.length - perDay + (subIndex % perDay), subIndex + days * perDay));
      showPreview({ startMin, dx: target < 0 ? 0 : (target - subIndex) * subW, target });
    },
    [hourH, snap, seg.startMin, subIndex, subCols.length, subW, perDay, showPreview, edge],
  );
  const onPanEnd = useCallback(() => {
    const p = previewRef.current;
    const shift = edge.shiftRef.current;
    edge.reset();
    setLifted(false);
    showPreview(null);
    if (!p || !moved.current) return;
    const targetDate = addDaysKey(p.target >= 0 ? subCols[p.target].date : date, shift);
    if (p.startMin !== seg.startMin || targetDate !== date) onMove(seg, p.startMin, targetDate);
    // Held at an edge: the view goes to the days it was moved to.
    if (shift) onShift(shift);
  }, [subCols, date, seg, onMove, showPreview, edge, onShift]);
  // The handlers read refs, which is fine: the gesture system calls them while a finger moves, never during render.
  /* eslint-disable react-hooks/refs */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(movable)
        .runOnJS(true)
        .activateAfterLongPress(420)
        .onStart(onPanStart)
        .onUpdate(onPanUpdate)
        .onEnd(onPanEnd)
        .onFinalize(() => {
          setLifted(false);
          edge.reset();
        }),
    [movable, onPanStart, onPanUpdate, onPanEnd, edge],
  );
  /* eslint-enable react-hooks/refs */
  const tap = useMemo(() => Gesture.Tap().runOnJS(true).onEnd(() => onTap(seg.occ)), [onTap, seg.occ]);
  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);
  const startMin = preview?.startMin ?? seg.startMin;
  const top = (startMin / 60) * hourH;
  const height = Math.max(metrics.eventTitle * 1.35, ((seg.endMin - seg.startMin) / 60) * hourH - 1);
  // Selected (the iPad's details pane shows it): filled with its colour, the text white, as Apple marks it.
  const text = selected ? "#ffffff" : readableTint(c, dark);
  const titleH = metrics.eventTitle * 1.25;
  const timeH = metrics.eventTime * 1.3;
  // As many title lines as fit, keeping one line for the time when there is room for it (never a half-cut line).
  const avail = height - 4;
  const showTime = !seg.occ.allDay && avail >= titleH + timeH;
  const titleLines = Math.max(1, Math.floor((avail - (showTime ? timeH : 0)) / titleH));
  const shownStart = preview ? seg.start + (preview.startMin - seg.startMin) * 60_000 : seg.start;
  const shownEnd = preview ? seg.end + (preview.startMin - seg.startMin) * 60_000 : seg.end;
  const clock = seg.end > seg.start ? `${formatTime(shownStart, viewerTz)} – ${formatTime(shownEnd, viewerTz)}` : formatTime(shownStart, viewerTz);
  return (
    <>
    {preview ? <DragBadge top={top} left={`${(seg.lane / seg.lanes) * 100}%`} dx={preview.dx} label={`${edge.shift ? `${shortDay(addDaysKey(preview.target >= 0 ? subCols[preview.target].date : date, edge.shift))} · ` : ""}${clock}`} /> : null}
    <GestureDetector gesture={gesture}>
      <View
        accessibilityRole="button"
        accessibilityLabel={seg.occ.title}
        style={[
          styles.event,
          { top, height, left: `${(seg.lane / seg.lanes) * 100}%`, width: `${100 / seg.lanes}%`, backgroundColor: selected ? c : dark ? mix(c, "#000000", 0.3) : mix(c, "#ffffff", 0.2), zIndex: lifted ? 40 : undefined, transform: [{ translateX: preview?.dx ?? 0 }, { scale: lifted ? 1.03 : 1 }] },
          lifted && styles.pillLifted,
        ]}
      >
        <View style={[styles.eventBar, { backgroundColor: c }]} />
        <View style={styles.eventText}>
          <Text allowFontScaling={false} numberOfLines={titleLines} style={[styles.eventTitle, { color: text, fontSize: metrics.eventTitle, lineHeight: titleH }]}>
            {seg.occ.title}
          </Text>
          {showTime ? (
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.eventTime, { color: text, fontSize: metrics.eventTime, lineHeight: timeH }]}>
              {clock}
            </Text>
          ) : null}
        </View>
      </View>
    </GestureDetector>
    </>
  );
});

/** While something is dragged: where it would go, over it ("Fri, Oct 2 · 10:00 AM"). */
function DragBadge({ top, left, dx, label }: { top: number; left: `${number}%`; dx: number; label: string }) {
  const colors = useColors();
  return (
    <View pointerEvents="none" style={[styles.badge, { top: Math.max(0, top - 26), left, transform: [{ translateX: dx }] }]}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.badgeText, { color: "#ffffff", backgroundColor: colors.blue }]}>
        {label}
      </Text>
    </View>
  );
}

interface TaskPillProps {
  seg: Seg<TaskOccurrence>;
  info: PersonInfo;
  hourH: number;
  metrics: Metrics;
  dark: boolean;
  colors: Colors;
  date: DateKey;
  person: PersonKey;
  subW: number;
  subIndex: number;
  subCols: { date: DateKey; person: PersonKey }[];
  selected: boolean;
  onTap: (occ: TaskOccurrence) => void;
  onMenu: (occ: TaskOccurrence) => void;
  onMove: (seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => void;
  edges: { current: { left: number; right: number } };
  onShift: (days: number) => void;
}

/**
 * A task at its due time, drawn as Apple Calendar draws a scheduled reminder: a grey block from the due time for half an
 * hour, the owner's ring (tap it to complete) and the title. Long-press lifts it and dragging moves it (across days and
 * people); a tap opens it.
 */
const TaskPill = memo(function TaskPill({ seg, hourH, metrics, colors, date, person, subW, subIndex, subCols, selected, onTap, onMenu, onMove, edges, onShift }: TaskPillProps) {
  const [preview, setPreview] = useState<{ startMin: number; dx: number; target: number } | null>(null);
  const edge = useEdgeShift(edges);
  const [lifted, setLifted] = useState(false);
  const moved = useRef(false);
  const o = seg.occ;
  const snap = snapFor(hourH);
  // The preview is also kept in a ref: the gesture's end reads it without going through a state update.
  const previewRef = useRef<{ startMin: number; dx: number; target: number } | null>(null);
  const showPreview = useCallback((p: { startMin: number; dx: number; target: number } | null) => {
    previewRef.current = p;
    setPreview(p);
  }, []);
  const onPanStart = useCallback(() => {
    moved.current = false;
    setLifted(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);
  const onPanUpdate = useCallback(
    (e: { translationX: number; translationY: number; absoluteX: number }) => {
      if (Math.abs(e.translationX) < 4 && Math.abs(e.translationY) < 4 && !moved.current) return;
      moved.current = true;
      edge.track(e.absoluteX);
      const deltaMin = Math.round(((e.translationY / hourH) * 60) / snap) * snap;
      const startMin = Math.min(24 * 60 - snap, Math.max(0, seg.startMin + deltaMin));
      const shift = subIndex < 0 ? 0 : Math.max(-subIndex, Math.min(subCols.length - 1 - subIndex, Math.round(e.translationX / subW)));
      showPreview({ startMin, dx: shift * subW, target: subIndex < 0 ? -1 : subIndex + shift });
    },
    [hourH, snap, seg.startMin, subIndex, subCols.length, subW, showPreview, edge],
  );
  const onPanEnd = useCallback(() => {
    const p = previewRef.current;
    const days = edge.shiftRef.current;
    edge.reset();
    setLifted(false);
    showPreview(null);
    if (p && moved.current) {
      const target = p.target >= 0 ? subCols[p.target] : { date, person };
      const targetDate = addDaysKey(target.date, days);
      // Held at an edge for another day, it stays whose it is (the edge is only over the other person's column).
      const owner = days ? person : target.person;
      if (p.startMin !== seg.startMin || targetDate !== date || owner !== person) onMove(seg, p.startMin, targetDate, owner);
      // Held at an edge: the view goes to the days it was moved to.
      if (days) onShift(days);
    } else onMenu(o);
  }, [subCols, date, person, seg, onMove, onMenu, o, showPreview, edge, onShift]);
  // The handlers read refs, which is fine: the gesture system calls them while a finger moves, never during render.
  /* eslint-disable react-hooks/refs */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activateAfterLongPress(420)
        .onStart(onPanStart)
        .onUpdate(onPanUpdate)
        .onEnd(onPanEnd)
        .onFinalize(() => {
          setLifted(false);
          edge.reset();
        }),
    [onPanStart, onPanUpdate, onPanEnd, edge],
  );
  /* eslint-enable react-hooks/refs */
  // A tap on the ring completes the task (its own button handles that); anywhere else on the block opens it.
  const ringZone = 3 + metrics.taskRing + 8;
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
          if (e.x > ringZone) onTap(o);
        }),
    [onTap, o, ringZone],
  );
  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);
  const startMin = preview?.startMin ?? seg.startMin;
  const top = (startMin / 60) * hourH;
  const height = Math.max(metrics.taskRing + 8, (Math.min(TASK_MINUTES, 24 * 60 - seg.startMin) / 60) * hourH - 1);
  const previewTime = preview ? `${edge.shift ? `${shortDay(addDaysKey(preview.target >= 0 ? subCols[preview.target].date : date, edge.shift))} · ` : ""}${formatHM(Math.floor(startMin / 60) % 24, startMin % 60)}` : null;
  const bangs = ["", "!", "!!", "!!!"][o.task.priority ?? 0];
  // Its category's colour.
  const ring = useTaskColor(o.task);
  return (
    <>
    {preview && previewTime ? <DragBadge top={top} left={`${(seg.lane / seg.lanes) * 100}%`} dx={preview.dx} label={previewTime} /> : null}
    <GestureDetector gesture={gesture}>
      <View
        accessibilityRole="button"
        accessibilityLabel={o.title}
        style={[
          styles.pill,
          { top, height, left: `${(seg.lane / seg.lanes) * 100}%`, width: `${100 / seg.lanes}%`, backgroundColor: selected ? colors.fill : colors.taskBlock, borderColor: selected ? ring : colors.taskBlockRim, zIndex: lifted ? 40 : 30, transform: [{ translateX: preview?.dx ?? 0 }, { scale: lifted ? 1.03 : 1 }] },
          lifted && styles.pillLifted,
        ]}
      >
        <Pressable accessibilityLabel={o.completed ? "Mark incomplete" : "Mark complete"} onPress={() => void setCompleted(o.task, o.dateKey, !o.completed)} hitSlop={8} style={[styles.check, { height: Math.min(height, metrics.taskRing + 8) }]}>
          <TaskRing color={ring} done={o.completed} size={metrics.taskRing} />
        </Pressable>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.pillText, { color: o.completed ? colors.label2 : colors.label, fontSize: metrics.eventTitle, lineHeight: Math.min(height, metrics.taskRing + 8) }]}>
          {bangs ? <Text style={{ color: colors.orange }}>{bangs} </Text> : null}
          {o.title}
        </Text>
      </View>
    </GestureDetector>
    </>
  );
});

/**
 * An all-day task or schedule over the timeline: a tap opens it; touch and hold lifts it to drag to another day (the
 * days side by side, or held at the view's edge for the days before or after).
 */
function AllDayChip({ occ, date, dateIndex, days, dateW, draggable, edges, onShift, onOpen, bar }: { occ: TaskOccurrence | EventOccurrence; date: DateKey; dateIndex: number; days: number; dateW: number; draggable: boolean; edges: { current: { left: number; right: number } }; onShift: (days: number) => void; onOpen: () => void; bar?: { openStart: boolean; openEnd: boolean } }) {
  const colors = useColors();
  const [dx, setDx] = useState(0);
  const [to, setTo] = useState(0);
  const [lifted, setLifted] = useState(false);
  const delta = useRef(0);
  const edge = useEdgeShift(edges);
  const movable = draggable && canMove(occ);
  // The handlers read refs, which is fine: the gesture system calls them while a finger moves, never during render.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const end = () => {
      edge.reset();
      delta.current = 0;
      setDx(0);
      setTo(0);
      setLifted(false);
    };
    const pan = Gesture.Pan()
      .enabled(movable)
      .activateAfterLongPress(350)
      .runOnJS(true)
      .onStart(() => {
        setLifted(true);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      })
      .onUpdate((e) => {
        edge.track(e.absoluteX);
        delta.current = Math.max(-dateIndex, Math.min(days - 1 - dateIndex, Math.round(e.translationX / dateW)));
        // Days side by side: it goes from day to day; one day: it follows the finger, to hold it at an edge.
        setDx(days > 1 ? delta.current * dateW : Math.max(-dateW * 0.4, Math.min(dateW * 0.4, e.translationX)));
        setTo(delta.current);
      })
      .onEnd(() => {
        const shift = edge.shiftRef.current;
        const total = delta.current + shift;
        end();
        if (total) {
          if (occ.kind === "task") moveTaskByDays(occ, total);
          else moveEventByDays(occ, total);
        }
        if (shift) onShift(shift);
      })
      .onFinalize(end);
    const tap = Gesture.Tap().runOnJS(true).onEnd(onOpen);
    return Gesture.Exclusive(pan, tap);
  }, [movable, edge, dateIndex, days, dateW, occ, onShift, onOpen]);
  /* eslint-enable react-hooks/refs */
  return (
    <GestureDetector gesture={gesture}>
      <View accessibilityRole="button" accessibilityLabel={occ.title} style={[lifted && styles.chipLifted, { transform: [{ translateX: dx }, { scale: lifted ? 1.05 : 1 }] }]}>
        {bar && occ.kind === "event" ? <EventBar occ={occ} openStart={bar.openStart} openEnd={bar.openEnd} /> : occ.kind === "event" ? <EventChip occ={occ} /> : <TaskChip occ={occ} />}
        {lifted && (to || edge.shift) ? (
          // Where it would go, on it (the strip over the timeline has no room around it).
          <View pointerEvents="none" style={styles.shiftBadge}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.badgeText, { color: "#ffffff", backgroundColor: colors.blue }]}>
              {shortDay(addDaysKey(date, to + edge.shift))}
            </Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

/** A week column's date as Apple's iPad week has it: "Tue 29", today's number in a red circle. */
function WeekColumnHeader({ date, today, colors, top, height }: { date: DateKey; today: DateKey; colors: Colors; top: number; height: number }) {
  const [y, mo, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const isToday = date === today;
  const weekend = wd === 0 || wd === 6;
  return (
    <View style={[styles.weekHead, { top, height }]}>
      <Text allowFontScaling={false} style={[styles.weekHeadText, { color: weekend ? colors.label2 : colors.label }]}>
        {WEEKDAY_SHORT[wd]}{" "}
      </Text>
      <View style={[styles.weekHeadNum, isToday && { backgroundColor: colors.red }]}>
        <Text allowFontScaling={false} style={[styles.weekHeadText, { color: isToday ? "#ffffff" : weekend ? colors.label2 : colors.label, fontWeight: isToday ? "600" : "400" }]}>
          {d}
        </Text>
      </View>
    </View>
  );
}

interface WeekStripProps {
  anchor: DateKey;
  days: number;
  today: DateKey;
  width: number;
  colors: Colors;
  metrics: Metrics;
  onPick: (k: DateKey) => void;
}

/** The week above the timeline: the selected day(s) highlighted; swiping moves a week. */
function WeekStrip({ anchor, days, today, width, colors, metrics: m, onPick }: WeekStripProps) {
  const ref = useRef<ScrollView>(null);
  const weekStart = addDaysKey(anchor, -weekdayOfKey(anchor));
  const weeks = [-1, 0, 1].map((p) => addDaysKey(weekStart, p * 7));
  const selected = new Set(Array.from({ length: days }, (_, i) => addDaysKey(anchor, i)));
  const last = addDaysKey(anchor, days - 1);
  useEffect(() => {
    ref.current?.scrollTo({ x: width, animated: false });
  }, [anchor, width]);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== 1) onPick(addDaysKey(anchor, (page - 1) * 7));
  };
  return (
    <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: width, y: 0 }} onMomentumScrollEnd={onEnd} style={[styles.week, { height: m.weekStrip, borderBottomColor: colors.separator }]}>
      {weeks.map((ws) => (
        <View key={ws} style={{ width, flexDirection: "row" }}>
          {Array.from({ length: 7 }, (_, i) => {
            const key = addDaysKey(ws, i);
            const sel = selected.has(key);
            const isToday = key === today;
            const weekend = i === 0 || i === 6;
            const first = key === anchor;
            const lastSel = key === last;
            return (
              <Pressable key={key} accessibilityRole="button" accessibilityLabel={`day ${key}`} onPress={() => onPick(key)} style={styles.weekDay}>
                <Text allowFontScaling={false} style={[styles.weekLetter, { color: weekend ? colors.gray : colors.label, fontSize: m.weekLetter, top: 12 - (m.grid - 1) * 4.4 }]}>
                  {WEEKDAY_LETTERS[i]}
                </Text>
                <View style={[styles.weekNumWrap, { top: m.weekDateCenter - m.weekMarkHeight / 2, height: m.weekMarkHeight }]}>
                  {sel ? (
                    // One day: Apple's mark (red today, the label colour otherwise). Two days: one mark across both.
                    <View
                      style={[
                        styles.weekSel,
                        days === 1
                          ? { width: m.weekMarkWidth, alignSelf: "center", borderRadius: m.weekMarkRadius }
                          : { left: first ? 6 : 0, right: lastSel ? 6 : 0, borderTopLeftRadius: first ? m.weekMarkRadius : 0, borderBottomLeftRadius: first ? m.weekMarkRadius : 0, borderTopRightRadius: lastSel ? m.weekMarkRadius : 0, borderBottomRightRadius: lastSel ? m.weekMarkRadius : 0 },
                        { backgroundColor: isToday ? colors.red : days === 1 ? colors.label : colors.bg3 === "#ffffff" ? "#e5e5ea" : "#3a3a3c" },
                      ]}
                    />
                  ) : null}
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.weekNum,
                      { fontSize: m.weekNumber, fontWeight: sel ? "600" : "400", color: sel && isToday ? "#ffffff" : sel && days === 1 ? colors.bg : sel ? colors.label : isToday ? colors.red : weekend ? colors.gray : colors.label },
                    ]}
                  >
                    {Number(key.slice(8, 10))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  weekHead: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  weekHeadText: { fontSize: 17 },
  weekHeadNum: { minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  fill: { flex: 1 },
  header: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 10 },
  tzRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8 },
  tz: { fontWeight: "600" },
  allDayLabel: { position: "absolute", right: 7.3, fontWeight: "500" },
  dateCol: { flex: 1, minWidth: 0 },
  dateTitle: { textAlign: "center", fontWeight: "600" },
  names: { flexDirection: "row" },
  name: { flex: 1, textAlign: "center", fontWeight: "600" },
  allDayRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", gap: 2, paddingHorizontal: 2 },
  allDayCol: { flex: 1, minWidth: 0, gap: 3 },
  spanLayer: { position: "absolute", left: 0 },
  spanPiece: { position: "absolute" },
  more: { textAlign: "center", fontWeight: "500" },
  hourRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  secondary: { position: "absolute", left: 8, flexDirection: "row", alignItems: "baseline", gap: 2 },
  secondaryNum: { fontVariant: ["tabular-nums"] },
  secondarySuffix: {},
  hourNum: { fontVariant: ["tabular-nums"] },
  hourSuffix: { marginLeft: 2, marginTop: 1 },
  noon: { fontWeight: "600" },
  nowBadge: { position: "absolute", right: 7.3 - 2, justifyContent: "center" },
  nowBadgeText: { color: "#ffffff", fontWeight: "600", fontVariant: ["tabular-nums"] },
  hourLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  dateBody: { flex: 1, flexDirection: "row" },
  subCol: { flex: 1, minWidth: 0 },
  nowLine: { position: "absolute", left: 0, right: 0, height: 2, zIndex: 20 },
  band: { position: "absolute", left: 1, right: 1, borderRadius: 5, borderLeftWidth: 3, overflow: "hidden" },
  bandTitle: { paddingHorizontal: 5, paddingTop: 3, fontSize: 11, fontWeight: "600", lineHeight: 13 },
  event: { position: "absolute", borderRadius: 5, overflow: "hidden", zIndex: 10, marginHorizontal: 1.5 },
  eventBar: { position: "absolute", left: 3, top: 3, bottom: 3, width: 3, borderRadius: 1.5 },
  eventText: { paddingLeft: 9, paddingRight: 4, paddingTop: 2 },
  eventTitle: { fontWeight: "600" },
  eventTime: {},
  pill: { position: "absolute", borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 3, paddingRight: 5, flexDirection: "row", alignItems: "flex-start", gap: 5, overflow: "hidden", marginHorizontal: 1.5 },
  pillLifted: { shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  badge: { position: "absolute", zIndex: 60 },
  badgeText: { fontSize: 13, fontWeight: "600", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, overflow: "hidden" },
  chipLifted: { zIndex: 50, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  shiftBadge: { position: "absolute", right: 2, top: 0, bottom: 0, justifyContent: "center" },
  check: { alignItems: "center", justifyContent: "center" },
  pillText: { fontWeight: "600", flexShrink: 1 },
  week: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  weekDay: { flex: 1, alignItems: "center" },
  weekLetter: { position: "absolute", fontWeight: "600" },
  weekNumWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  weekSel: { position: "absolute", top: 0, bottom: 0 },
  weekNum: { fontVariant: ["tabular-nums"] },
});
