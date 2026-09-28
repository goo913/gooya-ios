import type { DateKey, Schedule, TaskOccurrence } from "@shared/model";
import { describeRule, expandTask, occurrenceDays } from "@shared/recurrence";
import { addDaysKey, parseHHmm, parseKey, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { OccurrenceRow } from "@/components/OccurrenceRow";
import { Segmented } from "@/components/Segmented";
import { MONTH_SHORT, WEEKDAY_LONG, formatHM } from "@/lib/format";
import { useShowCompleted } from "@/lib/occurrences";
import { usePerson, usePersonColor } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";

const MAX_RESULTS = 200;
const matches = (hay: string | undefined, needle: string): boolean => !!hay && hay.toLowerCase().includes(needle);

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "completed">("all");
  const showCompleted = useShowCompleted();
  const tasks = useData((s) => s.tasks);
  const schedules = useData((s) => s.schedules);
  const today = useToday();
  const openDetail = useSheets((s) => s.openDetail);
  const openEditor = useSheets((s) => s.openEditor);
  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    const from = startOfDayMs(addDaysKey(today, -365), viewerTz);
    const to = startOfDayMs(addDaysKey(today, 365), viewerTz);
    const byDay = new Map<DateKey, TaskOccurrence[]>();
    let count = 0;
    for (const t of tasks) {
      const tagHit = (t.tags ?? []).some((tag) => matches(`#${tag}`, needle) || matches(tag, needle));
      const anyMatch = matches(t.title, needle) || matches(t.notes, needle) || tagHit || Object.values(t.overrides ?? {}).some((o) => matches(o.title, needle));
      if (!anyMatch) continue;
      for (const occ of expandTask(t, from, to)) {
        if (!(matches(occ.title, needle) || matches(occ.notes, needle) || tagHit)) continue;
        if (filter === "completed" ? !occ.completed : !showCompleted && occ.completed) continue;
        const day = occurrenceDays(occ, viewerTz)[0];
        let list = byDay.get(day);
        if (!list) byDay.set(day, (list = []));
        list.push(occ);
        if (++count >= MAX_RESULTS) break;
      }
      if (count >= MAX_RESULTS) break;
    }
    const days = Array.from(byDay.keys()).sort();
    const upcoming = days.filter((d) => d >= today);
    const past = days.filter((d) => d < today).reverse();
    return { days: [...upcoming, ...past], byDay, schedules: schedules.filter((s) => matches(s.title, needle)) };
  }, [needle, tasks, schedules, today, filter, showCompleted]);
  const openTask = (occ: TaskOccurrence) => {
    openEditor({ kind: "task", task: occ.task, occ });
    router.push("/sheet/edit");
  };
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg, paddingTop: insets.top + 10 }]}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: colors.fill3 }]}>
          <Icon name="magnifyingglass" size={17} color={colors.label2} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.label3} autoFocus returnKeyType="search" clearButtonMode="while-editing" style={[styles.input, { color: colors.label }]} />
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.cancel, { color: colors.blue }]}>Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.seg}>
        <Segmented<"all" | "completed">
          options={[
            { value: "all", label: "All" },
            { value: "completed", label: "Completed" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
        {results === null ? (
          <Text style={[styles.hint, { color: colors.label2 }]}>Search tasks and schedules for 구야 and 은비.</Text>
        ) : results.days.length === 0 && results.schedules.length === 0 ? (
          <Text style={[styles.hint, { color: colors.label2, fontSize: 17 }]}>No Results</Text>
        ) : (
          <>
            {results.schedules.length ? (
              <View>
                <Text style={[styles.section, { color: colors.label2 }]}>SCHEDULES</Text>
                {results.schedules.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    schedule={s}
                    onOpen={() => {
                      openDetail({ kind: "schedule", scheduleId: s.id, dateKey: today >= s.startDate ? today : s.startDate });
                      router.push("/sheet/detail");
                    }}
                  />
                ))}
              </View>
            ) : null}
            {results.days.map((day) => {
              const { y, m, d } = parseKey(day);
              const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
              const isToday = day === today;
              return (
                <View key={day}>
                  <View style={styles.dayHead}>
                    <Text style={[styles.dayName, { color: isToday ? colors.red : colors.label }]}>{WEEKDAY_LONG[wd]}</Text>
                    <Text style={[styles.dayDate, { color: isToday ? colors.red : colors.label2 }]}>
                      {MONTH_SHORT[m - 1]} {d}, {y}
                    </Text>
                  </View>
                  {results.byDay.get(day)!.map((occ) => (
                    <OccurrenceRow key={occ.key} occ={occ} onOpen={() => openTask(occ)} />
                  ))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ScheduleRow({ schedule, onOpen }: { schedule: Schedule; onOpen: () => void }) {
  const colors = useColors();
  const person = usePerson(schedule.owner);
  const color = usePersonColor(schedule.owner);
  const s = parseHHmm(schedule.startTime);
  const e = parseHHmm(schedule.endTime);
  return (
    <Pressable onPress={onOpen} style={[styles.schedRow, { borderBottomColor: colors.separator }]}>
      <Text style={styles.schedIcon}>{schedule.icon}</Text>
      <View style={[styles.schedBar, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.schedTitle, { color: colors.label }]}>
          {schedule.title}
        </Text>
        <Text numberOfLines={1} style={[styles.schedSub, { color: colors.label2 }]}>
          {person.name} · {describeRule(schedule.rrule)} · {formatHM(s.h, s.min)} – {formatHM(e.h, e.min)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  field: { flex: 1, height: 36, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  input: { flex: 1, fontSize: 17 },
  cancel: { fontSize: 17 },
  seg: { paddingHorizontal: 16, paddingBottom: 8 },
  hint: { paddingHorizontal: 24, paddingTop: 64, textAlign: "center", fontSize: 15 },
  section: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, fontSize: 13, fontWeight: "600" },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  dayName: { fontSize: 17, fontWeight: "600" },
  dayDate: { fontSize: 15 },
  schedRow: { marginLeft: 16, paddingRight: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  schedIcon: { width: 74, textAlign: "right", fontSize: 24 },
  schedBar: { width: 4, height: 34, borderRadius: 2 },
  schedTitle: { fontSize: 17, lineHeight: 22 },
  schedSub: { fontSize: 15, lineHeight: 19 },
});
