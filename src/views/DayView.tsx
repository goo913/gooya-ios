import type { DateKey, EventOccurrence, ScheduleOccurrence, TaskOccurrence } from "@shared/model";
import { otherPerson, type PersonKey } from "@shared/people";
import { splitByDay } from "@shared/recurrence";
import { DAY_MS, addDaysKey, fieldsInZone, formatHHmm, minutesSinceMidnight, startOfDayMs, weekdayOfKey, zonedMs } from "@shared/time";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventChip, TaskChip, TaskRing } from "@/components/Chips";
import { mix, tintText } from "@/lib/color";
import { MONTH_SHORT, WEEKDAY_LETTERS, WEEKDAY_LONG, formatColumnHeader, formatHM, formatTime, hourLabel, tzAbbrev } from "@/lib/format";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { useEventOccurrences, useScheduleOccurrences, useTaskOccurrences } from "@/lib/occurrences";
import { colorHex, useMe, usePerson, type PersonInfo } from "@/lib/people";
import { deleteScheduleDay, endScheduleBefore } from "@/lib/scheduleOps";
import { applyTaskEdit, deleteTaskScope, movedFields, setCompleted, type TaskFields } from "@/lib/taskOps";
import { useNow, useToday, viewerTz } from "@/lib/useNow";
import { deleteSchedule } from "@/lib/db";
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
  schedules: Seg<ScheduleOccurrence>[];
  events: Seg<EventOccurrence>[];
  allDayEvents: EventOccurrence[];
}

export interface DayActions {
  openTask: (occ: TaskOccurrence) => void;
  openSchedule: (occ: ScheduleOccurrence) => void;
  openEvent: (occ: EventOccurrence) => void;
  editTask: (occ: TaskOccurrence) => void;
  editSchedule: (occ: ScheduleOccurrence, dayOnly: boolean) => void;
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

function buildColumns(dates: DateKey[], people: PersonKey[], tasks: TaskOccurrence[], schedules: ScheduleOccurrence[], events: EventOccurrence[]): Map<string, ColumnData> {
  const map = new Map<string, ColumnData>();
  for (const d of dates) for (const p of people) map.set(colKey(d, p), { timed: [], allDay: [], schedules: [], events: [], allDayEvents: [] });
  const dateSet = new Set(dates);
  for (const occ of tasks) {
    if (!people.includes(occ.task.owner)) continue;
    if (occ.allDay) {
      if (dateSet.has(occ.dueDate)) map.get(colKey(occ.dueDate, occ.task.owner))!.allDay.push(occ);
      continue;
    }
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      map.get(colKey(s.dateKey, occ.task.owner))!.timed.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin: Math.min(24 * 60, s.startMin + TASK_MINUTES), lane: 0, lanes: 1 });
    }
  }
  for (const occ of schedules) {
    if (!people.includes(occ.schedule.owner)) continue;
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      map.get(colKey(s.dateKey, occ.schedule.owner))!.schedules.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin: s.endMin, lane: 0, lanes: 1 });
    }
  }
  for (const occ of events) {
    if (!people.includes(occ.event.owner)) continue;
    if (occ.allDay) {
      for (const d of dates) if (occ.startDate <= d && d <= occ.endDate) map.get(colKey(d, occ.event.owner))!.allDayEvents.push(occ);
      continue;
    }
    for (const s of splitByDay(occ, viewerTz)) {
      if (!dateSet.has(s.dateKey)) continue;
      map.get(colKey(s.dateKey, occ.event.owner))!.events.push({ occ, key: `${occ.key}@${s.dateKey}`, start: s.start, end: s.end, startMin: s.startMin, endMin: Math.max(s.endMin, s.startMin + 1), lane: 0, lanes: 1 });
    }
  }
  for (const c of map.values()) {
    assignLanes(c.timed);
    assignLanes(c.events);
    c.allDay.sort((a, b) => a.title.localeCompare(b.title));
    c.schedules.sort((a, b) => a.startMin - b.startMin);
  }
  return map;
}

const snapFor = (hourH: number): number => (hourH >= 110 ? 5 : 15);

function sheet(options: { label: string; destructive?: boolean; onSelect: () => void }[]) {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0) },
    (i) => options[i]?.onSelect(),
  );
}

export function DayView({ dateKey, onChangeDate, actions }: { dateKey: DateKey; onChangeDate: (k: DateKey) => void; actions: DayActions }) {
  const colors = useColors();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const me = useMe();
  const other = otherPerson(me);
  const m = useMetrics();
  const timelineDays = usePrefs((s) => s.timelineDays);
  const timelinePeople = usePrefs((s) => s.timelinePeople);
  // The zoom is stored at the default Text Size; Apple's hour grows with Text Size (50 points, 61.7 two steps up).
  const hourBase = usePrefs((s) => s.hourHeight);
  const hourH = Math.min(260, Math.max(20, hourBase * m.fontScale));
  const setHourHeight = usePrefs((s) => s.setHourHeight);
  const meInfo = usePerson(me);
  const otherInfo = usePerson(other);
  const infos: Record<PersonKey, PersonInfo> = me === "gooya" ? { gooya: meInfo, eunbi: otherInfo } : { gooya: otherInfo, eunbi: meInfo };
  const secondGutter = meInfo.settings.secondGutter;
  const intensity = meInfo.settings.scheduleIntensity ?? (dark ? 0.5 : 0.35);
  const days = timelineDays;
  const people = useMemo<PersonKey[]>(() => (timelinePeople === "me" ? [me] : timelinePeople === "other" ? [other] : [me, other]), [timelinePeople, me, other]);
  const todayNonce = useNav((s) => s.todayNonce);
  const today = useToday();
  const now = useNow(30_000);

  const pageDates = useMemo(() => [-1, 0, 1].map((p) => Array.from({ length: days }, (_, i) => addDaysKey(dateKey, p * days + i))), [dateKey, days]);
  const allDates = useMemo(() => pageDates.flat(), [pageDates]);
  const rangeStart = useMemo(() => startOfDayMs(allDates[0], viewerTz) - DAY_MS, [allDates]);
  const rangeEnd = useMemo(() => startOfDayMs(addDaysKey(allDates[allDates.length - 1], 1), viewerTz) + DAY_MS, [allDates]);
  const taskOcc = useTaskOccurrences(rangeStart, rangeEnd, people);
  const schedOcc = useScheduleOccurrences(rangeStart, rangeEnd, people);
  const eventOcc = useEventOccurrences(rangeStart, rangeEnd, people);
  const columns = useMemo(() => buildColumns(allDates, people, taskOcc, schedOcc, eventOcc), [allDates, people, taskOcc, schedOcc, eventOcc]);
  const allDayRows = useMemo(() => {
    let max = 0;
    for (const d of pageDates[1]) for (const p of people) {
      const c = columns.get(colKey(d, p));
      max = Math.max(max, Math.min(2, (c?.allDay.length ?? 0) + (c?.allDayEvents.length ?? 0)));
    }
    return max;
  }, [columns, pageDates, people]);

  const gutterW = m.gutter + (secondGutter ? 32 * m.day : 0);
  const pageW = width - gutterW;
  const titleH = m.dayTitle * 1.34;
  const namesH = people.length > 1 ? m.personName * 1.3 : 0;
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
  const fontScaleRef = useRef(m.fontScale);
  useEffect(() => {
    fontScaleRef.current = m.fontScale;
  }, [m.fontScale]);

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

  const scheduleMenu = useCallback(
    (occ: ScheduleOccurrence) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      sheet([
        { label: "Edit This Day Only", onSelect: () => actions.editSchedule(occ, true) },
        { label: "Edit Schedule…", onSelect: () => actions.editSchedule(occ, false) },
        { label: "Delete This Day Only", destructive: true, onSelect: () => void deleteScheduleDay(occ.schedule, occ.dateKey) },
        { label: "Delete All Future", destructive: true, onSelect: () => void endScheduleBefore(occ.schedule, occ.dateKey) },
        { label: "Delete Schedule", destructive: true, onSelect: () => void deleteSchedule(occ.schedule.id) },
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
        : [{ label: "Delete Task", destructive: true, onSelect: () => void deleteTaskScope(task, occ, "all") }];
      sheet([
        { label: occ.completed ? "Mark Incomplete" : "Mark Complete", onSelect: () => void setCompleted(task, occ.dateKey, !occ.completed) },
        { label: "Details", onSelect: () => actions.editTask(occ) },
        ...deletes,
      ]);
    },
    [actions],
  );
  const commitMove = useCallback((seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => {
    const task = seg.occ.task;
    const dueTime = formatHHmm(Math.floor(startMin / 60), startMin % 60);
    const fields: TaskFields = movedFields(task, seg.occ, date, dueTime, person, viewerTz);
    if (!task.rrule) return void applyTaskEdit(task, seg.occ, fields, "future");
    sheet([
      { label: "Save for This Task Only", onSelect: () => void applyTaskEdit(task, seg.occ, fields, "this") },
      { label: "Save for Future Tasks", onSelect: () => void applyTaskEdit(task, seg.occ, fields, "future") },
    ]);
  }, []);

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

  const subW = pageW / days / people.length;
  const subCols = useMemo(() => pageDates[1].flatMap((d) => people.map((p) => ({ date: d, person: p }))), [pageDates, people]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={{ backgroundColor: colors.bar }}>
      <View style={{ height: insets.top + m.barHeight }} />
      <WeekStrip anchor={dateKey} days={days} today={today} width={width} colors={colors} metrics={m} onPick={onChangeDate} />

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
                  <Text allowFontScaling={false} numberOfLines={1} style={[styles.dateTitle, { color: date === today && days > 1 ? colors.red : colors.label, fontSize: m.dayTitle, lineHeight: titleH, marginTop: people.length > 1 || allDayRows ? 7 : (m.dayTitleBand - titleH) / 2 }]}>
                    {days === 1 ? formatDayTitle(date) : formatColumnHeader(date)}
                  </Text>
                  {people.length > 1 ? (
                    <View style={[styles.names, { height: namesH }]}>
                      {people.map((pk) => (
                        <Text key={pk} allowFontScaling={false} numberOfLines={1} style={[styles.name, { color: colorHex(infos[pk].color, dark), fontSize: m.personName, lineHeight: namesH }]}>
                          {infos[pk].name}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {allDayRows ? (
                    <View style={[styles.allDayRow, { top: allDayTop }]}>
                      {people.map((pk) => {
                        const col = columns.get(colKey(date, pk));
                        const list: (TaskOccurrence | EventOccurrence)[] = [...(col?.allDayEvents ?? []), ...(col?.allDay ?? [])];
                        const overflow = list.length > 2 ? list.length - 1 : 0;
                        const visible = overflow ? list.slice(0, 1) : list;
                        return (
                          <View key={pk} style={styles.allDayCol}>
                            {visible.map((o) =>
                              o.kind === "event" ? (
                                <Pressable key={o.key} onPress={() => actions.openEvent(o)}>
                                  <EventChip occ={o} />
                                </Pressable>
                              ) : (
                                <Pressable key={o.key} onPress={() => actions.openTask(o)}>
                                  <TaskChip occ={o} />
                                </Pressable>
                              ),
                            )}
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
                        {people.map((pk, pi) => (
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
                            subIndex={p === 1 ? di * people.length + pi : -1}
                            subCols={subCols}
                            actions={actions}
                            onScheduleMenu={scheduleMenu}
                            onTaskMenu={taskMenu}
                            onMove={commitMove}
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
  actions: DayActions;
  onScheduleMenu: (occ: ScheduleOccurrence) => void;
  onTaskMenu: (occ: TaskOccurrence) => void;
  onMove: (seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => void;
}

const SubColumn = memo(function SubColumn({ date, person, info, data, hourH, metrics, divider, intensity, dark, colors, subW, subIndex, subCols, actions, onScheduleMenu, onTaskMenu, onMove }: SubColumnProps) {
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
        {data.schedules.map((seg) => (
          <ScheduleBand key={seg.key} seg={seg} info={info} hourH={hourH} metrics={metrics} intensity={intensity} dark={dark} colors={colors} onMenu={onScheduleMenu} onTap={actions.openSchedule} />
        ))}
        {data.events.map((seg) => (
          <EventBlock key={seg.key} seg={seg} hourH={hourH} metrics={metrics} dark={dark} colors={colors} onTap={actions.openEvent} />
        ))}
        {data.timed.map((seg) => (
          <TaskPill key={seg.key} seg={seg} info={info} hourH={hourH} metrics={metrics} dark={dark} colors={colors} date={date} person={person} subW={subW} subIndex={subIndex} subCols={subCols} onTap={actions.openTask} onMenu={onTaskMenu} onMove={onMove} />
        ))}
      </View>
    </GestureDetector>
  );
});

/**
 * Schedule band: the person's (or the schedule's own) colour mixed into the background at the chosen intensity, a
 * solid 3pt accent bar, and a bright (dark mode) or deep (light mode) tint for the title — like Apple Calendar.
 */
const ScheduleBand = memo(function ScheduleBand({ seg, info, hourH, metrics, intensity, dark, colors, onMenu, onTap }: { seg: Seg<ScheduleOccurrence>; info: PersonInfo; hourH: number; metrics: Metrics; intensity: number; dark: boolean; colors: Colors; onMenu: (occ: ScheduleOccurrence) => void; onTap: (occ: ScheduleOccurrence) => void }) {
  const sleep = seg.occ.schedule.kind === "sleep";
  const top = (seg.startMin / 60) * hourH;
  const height = Math.max(6, ((seg.endMin - seg.startMin) / 60) * hourH);
  const base = seg.occ.schedule.color ? colorHex(seg.occ.schedule.color, dark) : colorHex(info.color, dark);
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

/**
 * Imported event block, as Apple Calendar draws an event: its calendar's colour over the background, a rounded 3-point
 * bar inset at the left, the title in the calendar's colour, the time under it when there is room.
 */
const EventBlock = memo(function EventBlock({ seg, hourH, metrics, dark, colors, onTap }: { seg: Seg<EventOccurrence>; hourH: number; metrics: Metrics; dark: boolean; colors: Colors; onTap: (occ: EventOccurrence) => void }) {
  const c = seg.occ.event.color || colors.blue;
  const top = (seg.startMin / 60) * hourH;
  const height = Math.max(metrics.eventTitle * 1.35, ((seg.endMin - seg.startMin) / 60) * hourH - 1);
  const text = dark ? mix(c, "#ffffff", 0.08) : mix(c, "#000000", 0.3);
  const titleH = metrics.eventTitle * 1.25;
  return (
    <Pressable onPress={() => onTap(seg.occ)} style={[styles.event, { top, height, left: `${(seg.lane / seg.lanes) * 100}%`, width: `${100 / seg.lanes}%`, backgroundColor: dark ? mix(c, "#000000", 0.3) : mix(c, "#ffffff", 0.2) }]}>
      <View style={[styles.eventBar, { backgroundColor: c }]} />
      <View style={styles.eventText}>
        <Text allowFontScaling={false} numberOfLines={height > titleH * 2.6 ? 2 : 1} style={[styles.eventTitle, { color: text, fontSize: metrics.eventTitle, lineHeight: titleH }]}>
          {seg.occ.title}
        </Text>
        {height >= titleH + metrics.eventTime * 1.3 + 4 && !seg.occ.allDay ? (
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.eventTime, { color: text, fontSize: metrics.eventTime }]}>
            {formatTime(seg.start, viewerTz)} – {formatTime(seg.end, viewerTz)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

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
  onTap: (occ: TaskOccurrence) => void;
  onMenu: (occ: TaskOccurrence) => void;
  onMove: (seg: Seg<TaskOccurrence>, startMin: number, date: DateKey, person: PersonKey) => void;
}

/**
 * A task at its due time, drawn as Apple Calendar draws a scheduled reminder: a grey block from the due time for half an
 * hour, the owner's ring (tap it to complete) and the title. Long-press lifts it and dragging moves it (across days and
 * people); a tap opens it.
 */
const TaskPill = memo(function TaskPill({ seg, info, hourH, metrics, dark, colors, date, person, subW, subIndex, subCols, onTap, onMenu, onMove }: TaskPillProps) {
  const [preview, setPreview] = useState<{ startMin: number; dx: number; target: number } | null>(null);
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
    (e: { translationX: number; translationY: number }) => {
      if (Math.abs(e.translationX) < 4 && Math.abs(e.translationY) < 4 && !moved.current) return;
      moved.current = true;
      const deltaMin = Math.round(((e.translationY / hourH) * 60) / snap) * snap;
      const startMin = Math.min(24 * 60 - snap, Math.max(0, seg.startMin + deltaMin));
      const shift = subIndex < 0 ? 0 : Math.max(-subIndex, Math.min(subCols.length - 1 - subIndex, Math.round(e.translationX / subW)));
      showPreview({ startMin, dx: shift * subW, target: subIndex < 0 ? -1 : subIndex + shift });
    },
    [hourH, snap, seg.startMin, subIndex, subCols.length, subW, showPreview],
  );
  const onPanEnd = useCallback(() => {
    const p = previewRef.current;
    setLifted(false);
    showPreview(null);
    if (p && moved.current) {
      const target = p.target >= 0 ? subCols[p.target] : { date, person };
      if (p.startMin !== seg.startMin || target.date !== date || target.person !== person) onMove(seg, p.startMin, target.date, target.person);
    } else onMenu(o);
  }, [subCols, date, person, seg, onMove, onMenu, o, showPreview]);
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
        .onFinalize(() => setLifted(false)),
    [onPanStart, onPanUpdate, onPanEnd],
  );
  /* eslint-enable react-hooks/refs */
  const tap = useMemo(() => Gesture.Tap().runOnJS(true).onEnd(() => onTap(o)), [onTap, o]);
  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);
  const startMin = preview?.startMin ?? seg.startMin;
  const top = (startMin / 60) * hourH;
  const height = Math.max(metrics.taskRing + 8, (Math.min(TASK_MINUTES, 24 * 60 - seg.startMin) / 60) * hourH - 1);
  const previewTime = preview ? formatHM(Math.floor(startMin / 60) % 24, startMin % 60) : null;
  const bangs = ["", "!", "!!", "!!!"][o.task.priority ?? 0];
  const ring = colorHex(info.color, dark);
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityRole="button"
        accessibilityLabel={o.title}
        style={[
          styles.pill,
          { top, height, left: `${(seg.lane / seg.lanes) * 100}%`, width: `${100 / seg.lanes}%`, backgroundColor: colors.taskBlock, borderColor: colors.taskBlockRim, zIndex: lifted ? 40 : 30, transform: [{ translateX: preview?.dx ?? 0 }, { scale: lifted ? 1.03 : 1 }] },
          lifted && styles.pillLifted,
        ]}
      >
        <Pressable accessibilityLabel={o.completed ? "Mark incomplete" : "Mark complete"} onPress={() => void setCompleted(o.task, o.dateKey, !o.completed)} hitSlop={8} style={[styles.check, { height: Math.min(height, metrics.taskRing + 8) }]}>
          <TaskRing color={ring} done={o.completed} size={metrics.taskRing} />
        </Pressable>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.pillText, { color: o.completed ? colors.label2 : colors.label, fontSize: metrics.eventTitle, lineHeight: Math.min(height, metrics.taskRing + 8) }]}>
          {previewTime ? `${previewTime} · ` : ""}
          {bangs ? <Text style={{ color: colors.orange }}>{bangs} </Text> : null}
          {o.title}
        </Text>
      </View>
    </GestureDetector>
  );
});

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
  check: { alignItems: "center", justifyContent: "center" },
  pillText: { fontWeight: "600", flexShrink: 1 },
  week: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  weekDay: { flex: 1, alignItems: "center" },
  weekLetter: { position: "absolute", fontWeight: "600" },
  weekNumWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  weekSel: { position: "absolute", top: 0, bottom: 0 },
  weekNum: { fontVariant: ["tabular-nums"] },
});
