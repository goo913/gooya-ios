import type { DateKey, TaskOccurrence } from "@shared/model";
import { parseKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { pickOption } from "@/components/Form";
import { GlassPill } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { OccurrenceRow } from "@/components/OccurrenceRow";
import { patchSettings } from "@/lib/db";
import { MONTH_SHORT, WEEKDAY_LONG } from "@/lib/format";
import { SMART, useListOccurrences, type SmartList } from "@/lib/listOccurrences";
import { useFilteredPeople, useMe, usePerson } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { isReminderList } from "@shared/reminders";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";

/** One list (smart or shared): rows grouped by day like Reminders' Scheduled view. */
export default function ListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: listId } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = useFilteredPeople();
  const today = useToday();
  const lists = useData((s) => s.lists);
  const occ = useListOccurrences(people, today);
  const openEditor = useSheets((s) => s.openEditor);
  const showCompleted = usePerson(me).settings.showCompleted;
  const smart = listId.startsWith("smart:") ? (listId.slice(6) as SmartList) : null;
  const list = smart ? null : lists.find((l) => l.id === listId);
  const rows = useMemo(() => {
    let items = occ;
    if (smart === "today") items = items.filter((o) => !o.completed && o.dueDate && o.dueDate <= today);
    else if (smart === "scheduled") items = items.filter((o) => !!o.dueDate);
    else if (smart === "flagged") items = items.filter((o) => o.task.flagged);
    else if (smart === "completed") items = items.filter((o) => o.completed);
    else if (smart !== "all") items = items.filter((o) => o.task.listId === listId);
    if (smart !== "completed" && !showCompleted) items = items.filter((o) => !o.completed);
    items = [...items].sort((a, b) => ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : (a.dueDate || "9999") > (b.dueDate || "9999") ? 1 : a.start - b.start));
    const groups = new Map<string, TaskOccurrence[]>();
    for (const o of items) {
      const k = o.dueDate || "No Date";
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(o);
    }
    return groups;
  }, [occ, smart, listId, showCompleted, today]);
  const title = smart ? (SMART.find((s) => s.key === smart)?.label ?? "List") : (list?.name ?? "List");
  const color = smart ? (SMART.find((s) => s.key === smart)?.color ?? "#0091ff") : (list?.color ?? "#0091ff");
  const total = Array.from(rows.values()).reduce((n, g) => n + g.length, 0);
  const openTask = (o: TaskOccurrence) => {
    openEditor({ kind: "task", task: o.task, occ: o.dateKey ? o : undefined });
    router.push("/sheet/edit");
  };
  const newTask = () => {
    openEditor({ kind: "task", initialOwner: me, initialListId: list?.id, initialDate: smart === "today" ? today : undefined });
    router.push("/sheet/edit");
  };
  const more = () =>
    // A Reminders list is named and coloured in Reminders (a change here would come back as it was).
    pickOption([showCompleted ? "Hide Completed" : "Show Completed", ...(list && !isReminderList(list) ? ["Edit List"] : [])], null, (_, i) => {
      if (i === 0) void patchSettings(me, { showCompleted: !showCompleted });
      else if (list) router.push({ pathname: "/sheet/listEdit", params: { id: list.id } });
    });
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 58, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color }]}>{title}</Text>
          <Pressable accessibilityLabel="More" onPress={more} style={[styles.more, { backgroundColor: colors.fill3 }]}>
            <Icon name="ellipsis" size={18} color={colors.blue} weight="semibold" />
          </Pressable>
        </View>
        {total === 0 ? <Text style={[styles.empty, { color: colors.label2 }]}>No Tasks</Text> : null}
        {Array.from(rows.entries()).map(([day, items]) => (
          <View key={day}>
            <DayHeader day={day} today={today} />
            {items.map((o) => (
              <OccurrenceRow key={o.key} occ={o} onOpen={() => openTask(o)} />
            ))}
          </View>
        ))}
      </ScrollView>
      <TopChrome back="Lists" onBack={() => router.back()} onAdd={newTask} onSearch={() => router.push("/search")} />
      <BottomChrome
        showToday={false}
        left={
          <GlassPill label="New Task" onPress={newTask} style={{ paddingHorizontal: 18 }}>
            <Icon name="plus" size={20} color={colors.blue} weight="semibold" />
            <Text style={[styles.newTask, { color: colors.blue }]}>New Task</Text>
          </GlassPill>
        }
        onSettings={() => router.push("/settings")}
        onCalendars={() => router.push("/calendars")}
      />
    </View>
  );
}

function DayHeader({ day, today }: { day: string; today: DateKey }) {
  const colors = useColors();
  if (day === "No Date") return <Text style={[styles.dayName, { color: colors.label2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }]}>No Date</Text>;
  const { y, m, d } = parseKey(day);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isToday = day === today;
  const overdue = day < today;
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
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  dayName: { fontSize: 17, fontWeight: "600" },
  dayDate: { fontSize: 15 },
  newTask: { fontSize: 19, fontWeight: "600" },
});
