import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { addDaysKey, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TaskRing } from "@/components/Chips";
import { MONTH_SHORT, WEEKDAY_LONG, formatTime } from "@/lib/format";
import { useEventsByDay, useTasksByDay } from "@/lib/occurrences";
import { useFilteredPeople, usePerson, useTaskColor } from "@/lib/people";
import { setCompleted } from "@/lib/taskOps";
import { useToday, viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useNav } from "@/store/nav";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";

const PAST_DAYS = 14;
const FUTURE_DAYS = 120;

type Item = TaskOccurrence | EventOccurrence;

/** "Tuesday – Sep 29" */
export function dayHeading(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} – ${MONTH_SHORT[m - 1]} ${d}`;
}

function openItem(o: Item, day: DateKey): void {
  const { openDetail } = useSheets.getState();
  if (o.kind === "event") openDetail({ kind: "event", eventId: o.event.id, dateKey: day });
  else openDetail({ kind: "task", taskId: o.task.id, dateKey: o.dateKey });
  router.push("/sheet/detail");
}

/**
 * Apple Calendar's List: the days that have something, each with its tasks and events in time order (all-day first).
 * From the month screen it opens two weeks back and scrolls to today; from a day it starts at that day.
 */
export function ListView({ from, topInset = 0 }: { from?: DateKey; topInset?: number }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const people = useFilteredPeople();
  const todayNonce = useNav((s) => s.todayNonce);
  const first = from ?? addDaysKey(today, -PAST_DAYS);
  const start = useMemo(() => startOfDayMs(first, viewerTz), [first]);
  const end = useMemo(() => startOfDayMs(addDaysKey(from ?? today, FUTURE_DAYS), viewerTz), [from, today]);
  const tasksByDay = useTasksByDay(start, end, people, viewerTz);
  const eventsByDay = useEventsByDay(start, end, people, viewerTz);
  const days = useMemo(() => {
    const keys = new Set<DateKey>([...tasksByDay.keys(), ...eventsByDay.keys()]);
    return [...keys].filter((k) => k >= first).sort();
  }, [tasksByDay, eventsByDay, first]);
  const scrollRef = useRef<ScrollView>(null);
  const todayY = useRef(0);
  const firstFuture = from ? null : days.find((d) => d >= today);
  useEffect(() => {
    if (todayNonce > 0) scrollRef.current?.scrollTo({ y: todayY.current, animated: true });
  }, [todayNonce]);
  return (
    <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={{ paddingTop: topInset, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
      {days.length === 0 ? <Text style={[styles.empty, { color: colors.label2 }]}>No Events</Text> : null}
      {days.map((day) => {
        const isToday = day === today;
        const events = eventsByDay.get(day) ?? [];
        const tasks = tasksByDay.get(day) ?? [];
        const items: Item[] = [...events, ...tasks].sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start));
        return (
          <View
            key={day}
            onLayout={(e) => {
              if (day === firstFuture) {
                todayY.current = e.nativeEvent.layout.y;
                scrollRef.current?.scrollTo({ y: todayY.current, animated: false });
              }
            }}
          >
            <Text style={[styles.dayHead, { color: isToday ? colors.red : colors.label, borderBottomColor: colors.separator }]}>{dayHeading(day)}</Text>
            {items.map((o) => (o.kind === "event" ? <EventRow key={o.key} occ={o} day={day} /> : <TaskRow key={o.key} occ={o} day={day} />))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Times({ start, end, allDay }: { start: number; end?: number; allDay: boolean }) {
  const colors = useColors();
  if (allDay) return <Text style={[styles.time, { color: colors.label }]}>all-day</Text>;
  return (
    <View style={styles.times}>
      <Text style={[styles.time, { color: colors.label }]}>{formatTime(start, viewerTz)}</Text>
      {end != null ? <Text style={[styles.time, { color: colors.label2 }]}>{formatTime(end, viewerTz)}</Text> : null}
    </View>
  );
}

export function EventRow({ occ, day }: { occ: EventOccurrence; day: DateKey }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={occ.title} onPress={() => openItem(occ, day)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.separator, backgroundColor: pressed ? colors.fill4 : "transparent" }]}>
      <View style={[styles.bar, { backgroundColor: occ.event.color || colors.blue }]} />
      <View style={styles.text}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.label }]}>
          {occ.title}
        </Text>
        {occ.event.location ? (
          <Text numberOfLines={1} style={[styles.sub, { color: colors.label2 }]}>
            {occ.event.location}
          </Text>
        ) : null}
      </View>
      {/* A schedule without an end time shows its start only. */}
      <Times start={occ.start} end={occ.end > occ.start ? occ.end : undefined} allDay={occ.allDay} />
    </Pressable>
  );
}

export function TaskRow({ occ, day }: { occ: TaskOccurrence; day: DateKey }) {
  const colors = useColors();
  const person = usePerson(occ.task.owner);
  const list = useData((s) => s.lists.find((l) => l.id === occ.task.listId));
  const ring = useTaskColor(occ.task);
  const bangs = ["", "!", "!!", "!!!"][occ.task.priority ?? 0];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={occ.title} onPress={() => openItem(occ, day)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.separator, backgroundColor: pressed ? colors.fill4 : "transparent" }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={occ.completed ? "Mark incomplete" : "Mark complete"} hitSlop={10} onPress={() => void setCompleted(occ.task, occ.dateKey, !occ.completed)} style={styles.ring}>
        <TaskRing color={ring} done={occ.completed} size={22} />
      </Pressable>
      <View style={styles.text}>
        <Text numberOfLines={2} style={[styles.title, { color: occ.completed ? colors.label2 : colors.label }]}>
          {bangs ? <Text style={{ color: colors.orange }}>{bangs} </Text> : null}
          {occ.title}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: colors.label2 }]}>
          {person.name}
          {list && list.id !== "tasks" ? ` · ${list.name}` : ""}
        </Text>
      </View>
      <Times start={occ.start} allDay={occ.allDay} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { paddingHorizontal: 16, paddingTop: 64, textAlign: "center", fontSize: 17 },
  dayHead: { marginHorizontal: 12, paddingHorizontal: 5, paddingTop: 22, paddingBottom: 12, fontSize: 21, fontWeight: "600", borderBottomWidth: StyleSheet.hairlineWidth },
  row: { marginHorizontal: 12, flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 11, paddingLeft: 5, paddingRight: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { width: 3.7, alignSelf: "stretch", borderRadius: 2, marginRight: 2 },
  ring: { width: 26, alignItems: "center", paddingTop: 1 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  sub: { fontSize: 15, lineHeight: 20 },
  times: { alignItems: "flex-end", gap: 2 },
  time: { fontSize: 15, lineHeight: 20, fontVariant: ["tabular-nums"], textAlign: "right" },
});
