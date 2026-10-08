import { categoryOfList, isCategory } from "@shared/categories";
import type { DateKey, EventOccurrence, Routine, TaskOccurrence } from "@shared/model";
import { listSchedules, taskDay } from "@shared/lists";
import { describeRule, eventDays } from "@shared/recurrence";
import { parseHHmm, parseKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { pickOption } from "@/components/Form";
import { GlassPill } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { OccurrenceRow, useTimeColumnWidth } from "@/components/OccurrenceRow";
import { patchSettings } from "@/lib/db";
import { MONTH_SHORT, WEEKDAY_LONG, formatHM, formatTime, tzAbbrev } from "@/lib/format";
import { LIBRARY, SMART, useListOccurrences, type LibraryKind, type SmartList } from "@/lib/listOccurrences";
import { listIndexOf, scheduleHex, useFilteredPeople, useMe, usePerson, usePersonColor } from "@/lib/people";
import { useNow, useToday, viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors, useIsDark } from "@/theme";
import { isMac } from "../../../modules/gooya-mac";

type Row = { kind: "task"; key: string; occ: TaskOccurrence } | { kind: "schedule"; key: string; occ: EventOccurrence };

/**
 * One list: a smart list (Today, Scheduled, All, Completed: tasks), a category (its tasks and its schedules), a
 * Reminders list in no category (its tasks), or one of Library's (every task, every schedule, every routine). Tasks and
 * schedules are grouped by day as Reminders' Scheduled view is; schedules that have ended come last, newest first.
 */
export default function ListScreen() {
  const colors = useColors();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const { id: listId } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = useFilteredPeople();
  const today = useToday();
  const lists = useData((s) => s.lists);
  const schedules = useData((s) => s.schedules);
  const routines = useData((s) => s.routines);
  const users = useData((s) => s.users);
  const occ = useListOccurrences(people, today);
  const openEditor = useSheets((s) => s.openEditor);
  const openDetail = useSheets((s) => s.openDetail);
  const settings = usePerson(me).settings;
  const showCompleted = settings.showCompleted;
  // Reminders' "4 Completed · Show": done tasks shown on this page while completed tasks are hidden elsewhere.
  const [doneShown, setDoneShown] = useState(false);
  const showDone = showCompleted || doneShown;
  const showPast = settings.showPastSchedules;
  const smart = listId.startsWith("smart:") ? (listId.slice(6) as SmartList) : null;
  const library = listId.startsWith("kind:") ? (listId.slice(5) as LibraryKind) : null;
  const list = smart || library ? null : lists.find((l) => l.id === listId);
  const category = list && isCategory(list) ? list : null;
  const byId = listIndexOf(lists);
  // A schedule has ended once its end is past (this, kept fresh by the minute).
  const now = useNow(60_000);

  const { groups, past, doneCount } = useMemo(() => {
    const rows: { day: string; row: Row; start: number }[] = [];
    let doneCount = 0;
    // Tasks: a smart list's, a category's or Reminders list's, or all of them.
    if (library !== "schedules" && library !== "routines") {
      let items = occ;
      // Each task on its day as the calendar shows it (one due in another time zone may be a day off its own date).
      if (smart === "today") items = items.filter((o) => !o.completed && !!o.dueDate && taskDay(o, viewerTz) <= today);
      else if (smart === "scheduled") items = items.filter((o) => !!o.dueDate);
      else if (smart === "completed") items = items.filter((o) => o.completed);
      // A category: its tasks, through their owners' Reminders lists too; a Reminders list in no category: its own.
      else if (!smart && !library) items = items.filter((o) => o.task.listId === listId || categoryOfList(o.task.listId, byId)?.id === listId);
      if (smart !== "completed") {
        doneCount = items.filter((o) => o.completed).length;
        if (!showDone) items = items.filter((o) => !o.completed);
      }
      for (const o of items) rows.push({ day: taskDay(o, viewerTz) || "No Date", row: { kind: "task", key: o.key, occ: o }, start: o.start });
    }
    // Schedules: a category's, or all of them. Each once: a repeating one at its next day (or its last, once it has
    // ended); ones that have ended under Past Schedules.
    const pastRows: { day: string; row: Row; start: number }[] = [];
    if (category || library === "schedules") {
      for (const { schedule, occ: o, over } of listSchedules(schedules, people, today, now, viewerTz, (x) => scheduleHex(x, users, lists, dark))) {
        if (category && schedule.categoryId !== category.id) continue;
        (over ? pastRows : rows).push({ day: eventDays(o, viewerTz)[0], row: { kind: "schedule", key: o.key, occ: o }, start: o.start });
      }
    }
    const byDay = (list: typeof rows, newestFirst: boolean) => {
      const sorted = [...list].sort((a, b) => {
        const da = a.day === "No Date" ? "9999" : a.day;
        const db = b.day === "No Date" ? "9999" : b.day;
        if (da !== db) return (da < db ? -1 : 1) * (newestFirst ? -1 : 1);
        return a.start - b.start;
      });
      const map = new Map<string, Row[]>();
      for (const { day, row } of sorted) {
        let g = map.get(day);
        if (!g) map.set(day, (g = []));
        g.push(row);
      }
      return map;
    };
    return { groups: byDay(rows, false), past: showPast ? byDay(pastRows, true) : new Map<string, Row[]>(), doneCount };
  }, [occ, smart, library, listId, byId, showDone, showPast, today, category, schedules, people, users, lists, dark, now]);

  const routineRows = useMemo(
    () => (library === "routines" ? routines.filter((r) => people.includes(r.owner)).sort((a, b) => people.indexOf(a.owner) - people.indexOf(b.owner) || a.startTime.localeCompare(b.startTime)) : []),
    [library, routines, people],
  );

  const meta = smart ? SMART.find((s) => s.key === smart) : library ? LIBRARY.find((l) => l.key === library) : null;
  const title = meta?.label ?? list?.name ?? "List";
  const color = meta?.color ?? list?.color ?? "#0091ff";
  const total = library === "routines" ? routineRows.length : [...groups.values(), ...past.values()].reduce((n, g) => n + g.length, 0);
  const empty = library === "routines" ? "No Routines" : library === "schedules" ? "No Schedules" : category ? "No Tasks or Schedules" : "No Tasks";
  const newKind = library === "schedules" ? "schedule" : library === "routines" ? "routine" : "task";
  const newLabel = library === "schedules" ? "New Schedule" : library === "routines" ? "New Routine" : "New Task";
  const openTask = (o: TaskOccurrence) => {
    openEditor({ kind: "task", task: o.task, occ: o.dateKey ? o : undefined });
    router.push("/sheet/edit");
  };
  const openSchedule = (o: EventOccurrence) => {
    openDetail({ kind: "event", eventId: o.event.id, dateKey: o.dateKey });
    router.push("/sheet/detail");
  };
  const openRoutine = (r: Routine) => {
    // No day: its details show the next one (the one going on, if any).
    openDetail({ kind: "routine", routineId: r.id, dateKey: "" });
    router.push("/sheet/detail");
  };
  // A new item here: in this category (task or schedule), or of this Library's kind.
  const newItem = () => {
    openEditor({ kind: newKind, initialOwner: me, initialListId: list?.id, initialDate: smart === "today" ? today : undefined });
    router.push("/sheet/edit");
  };
  const more = () =>
    // A Reminders list in no category is named and coloured in Reminders (a change here would come back as it was).
    pickOption([showCompleted ? "Hide Completed" : "Show Completed", ...(category ? ["Edit Category"] : [])], null, (_, i) => {
      if (i === 0) void patchSettings(me, { showCompleted: !showCompleted });
      else if (category) router.push({ pathname: "/sheet/listEdit", params: { id: category.id } });
    });
  const renderRow = (row: Row) =>
    row.kind === "task" ? <OccurrenceRow key={row.key} occ={row.occ} onOpen={() => openTask(row.occ)} /> : <ScheduleRow key={row.key} occ={row.occ} onOpen={() => openSchedule(row.occ)} />;
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 58, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color }]}>{title}</Text>
          {library === "routines" || library === "schedules" ? null : (
            <Pressable accessibilityLabel="More" onPress={more} style={[styles.more, { backgroundColor: colors.fill3 }]}>
              <Icon name="ellipsis" size={18} color={colors.blue} weight="semibold" />
            </Pressable>
          )}
        </View>
        {doneCount && !showCompleted ? (
          <View style={[styles.doneRow, { borderBottomColor: colors.separator }]}>
            <Text style={[styles.doneText, { color: colors.label2 }]}>{doneCount} Completed</Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDoneShown(!doneShown)}>
              <Text style={[styles.doneText, { color: colors.blue }]}>{doneShown ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
        ) : null}
        {total === 0 ? <Text style={[styles.empty, { color: colors.label2 }]}>{empty}</Text> : null}
        {library === "routines"
          ? routineRows.map((r) => <RoutineRow key={r.id} routine={r} onOpen={() => openRoutine(r)} />)
          : Array.from(groups.entries()).map(([day, items]) => (
              <View key={day}>
                <DayHeader day={day} today={today} overdue={items.some((r) => r.kind === "task" && !r.occ.completed)} />
                {items.map(renderRow)}
              </View>
            ))}
        {past.size ? (
          <>
            <Text style={[styles.section, { color: colors.label2 }]}>Past Schedules</Text>
            {Array.from(past.entries()).map(([day, items]) => (
              <View key={`past${day}`}>
                <DayHeader day={day} today={today} overdue={false} />
                {items.map(renderRow)}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      {/* A Library list (from the month's menu) and any list on the Mac (from its sidebar) go back to the calendar. */}
      <TopChrome back={library || isMac ? "Calendar" : "Lists"} onBack={() => router.back()} onAdd={newItem} onSearch={() => router.push("/search")} />
      <BottomChrome
        showToday={false}
        left={
          <GlassPill label={newLabel} onPress={newItem} style={{ paddingHorizontal: 18 }}>
            <Icon name="plus" size={20} color={colors.blue} weight="semibold" />
            <Text style={[styles.newTask, { color: colors.blue }]}>{newLabel}</Text>
          </GlassPill>
        }
        onSettings={() => router.push("/settings")}
        onCalendars={() => router.push("/calendars")}
      />
    </View>
  );
}

/** A schedule in a list: its time (or all-day), its colour, its title, whose it is and where. */
function ScheduleRow({ occ, onOpen }: { occ: EventOccurrence; onOpen: () => void }) {
  const colors = useColors();
  const timeW = useTimeColumnWidth();
  const person = usePerson(occ.event.owner);
  const category = useData((s) => {
    const id = s.schedules.find((x) => x.id === occ.event.id)?.categoryId;
    return id ? s.lists.find((l) => l.id === id) : undefined;
  });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={occ.title} onPress={onOpen} style={[styles.row, { borderBottomColor: colors.separator }]}>
      <View style={[styles.time, { width: timeW }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.timeText, { color: occ.allDay ? colors.label2 : colors.label }]}>
          {occ.allDay ? "all-day" : formatTime(occ.start, viewerTz)}
        </Text>
        {!occ.allDay && occ.end > occ.start ? (
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.timeEnd, { color: colors.label2 }]}>
            {formatTime(occ.end, viewerTz)}
          </Text>
        ) : null}
      </View>
      <View style={[styles.bar, { backgroundColor: occ.event.color || colors.blue }]} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.label }]}>
          {occ.title}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: colors.label2 }]}>
          {person.name}
          {category ? ` · ${category.name}` : ""}
          {occ.event.location ? ` · ${occ.event.location}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * A routine, laid out as a schedule is: its hours in the time column (start over end, on its owner's clock, whose zone
 * is said when it is not this phone's), whose colour, its symbol and title, then whose and which days.
 */
function RoutineRow({ routine, onOpen }: { routine: Routine; onOpen: () => void }) {
  const colors = useColors();
  const person = usePerson(routine.owner);
  const color = usePersonColor(routine.owner);
  const timeW = useTimeColumnWidth();
  const s = parseHHmm(routine.startTime);
  const e = parseHHmm(routine.endTime);
  const zone = routine.timezone && routine.timezone !== viewerTz ? ` · ${tzAbbrev(routine.timezone)}` : "";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={routine.title} onPress={onOpen} style={[styles.row, { borderBottomColor: colors.separator }]}>
      <View style={[styles.time, { width: timeW }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.timeText, { color: colors.label }]}>
          {formatHM(s.h, s.min)}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.timeEnd, { color: colors.label2 }]}>
          {formatHM(e.h, e.min)}
        </Text>
      </View>
      <View style={[styles.bar, { backgroundColor: color }]} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.label }]}>
          {routine.icon ? `${routine.icon} ` : ""}
          {routine.title}
        </Text>
        <Text numberOfLines={2} style={[styles.sub, { color: colors.label2 }]}>
          {person.name} · {describeRule(routine.rrule)}
          {zone}
        </Text>
      </View>
    </Pressable>
  );
}

/** A day's heading: "Today" in blue; a day gone by in red only while a task on it is still to do (as Reminders shows one overdue). */
function DayHeader({ day, today, overdue: open }: { day: string; today: DateKey; overdue: boolean }) {
  const colors = useColors();
  if (day === "No Date") return <Text style={[styles.dayName, { color: colors.label2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }]}>No Date</Text>;
  const { y, m, d } = parseKey(day);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isToday = day === today;
  const overdue = open && day < today;
  const c = isToday ? colors.blue : overdue ? colors.red : colors.label;
  return (
    <View style={styles.dayHead}>
      <Text style={[styles.dayName, { color: c }]}>{isToday ? "Today" : WEEKDAY_LONG[wd]}</Text>
      <Text style={[styles.dayDate, { color: isToday || overdue ? c : colors.label2 }]}>
        {MONTH_SHORT[m - 1]} {d}
        {y !== Number(today.slice(0, 4)) ? `, ${y}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41 },
  more: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  empty: { paddingHorizontal: 16, paddingTop: 64, textAlign: "center", fontSize: 17 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 16, paddingRight: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  doneText: { fontSize: 15 },
  section: { paddingHorizontal: 16, paddingTop: 28, fontSize: 15, fontWeight: "600" },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  dayName: { fontSize: 17, fontWeight: "600" },
  dayDate: { fontSize: 15 },
  newTask: { fontSize: 19, fontWeight: "600" },
  row: { marginLeft: 16, paddingRight: 16, paddingVertical: 10, flexDirection: "row", alignItems: "flex-start", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  time: { alignItems: "flex-end", paddingTop: 1 },
  timeText: { fontSize: 15, lineHeight: 19, fontVariant: ["tabular-nums"] },
  timeEnd: { fontSize: 13, lineHeight: 17, fontVariant: ["tabular-nums"] },
  bar: { width: 4, height: 34, borderRadius: 2, marginTop: 2 },
  text: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 17, lineHeight: 22 },
  sub: { fontSize: 15, lineHeight: 19 },
});
