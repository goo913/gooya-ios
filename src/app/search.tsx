import type { DateKey, EventOccurrence, Routine, TaskOccurrence } from "@shared/model";
import { PEOPLE } from "@shared/people";
import { dedupeEvents, describeRule, eventDays, expandEvent, expandTask, occurrenceDays } from "@shared/recurrence";
import { scheduleAsEvent } from "@shared/schedules";
import { addDaysKey, parseHHmm, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { formatHM } from "@/lib/format";
import { useShowCompleted } from "@/lib/occurrences";
import { colorHex, useMe, usePerson, usePersonColor } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors, useIsDark } from "@/theme";
import { EventRow, TaskRow, dayHeading } from "@/views/ListView";

const MAX_RESULTS = 200;
const matches = (hay: string | undefined, needle: string): boolean => !!hay && hay.toLowerCase().includes(needle);

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "completed">("all");
  const showCompleted = useShowCompleted();
  const tasks = useData((s) => s.tasks);
  const routines = useData((s) => s.routines);
  const allEvents = useData((s) => s.events);
  const schedules = useData((s) => s.schedules);
  const users = useData((s) => s.users);
  const dark = useIsDark();
  const avoidDuplicates = usePerson(useMe()).settings.avoidDuplicates;
  // GOOYA's schedules, and imported events: the same event from two calendars once, as in the calendar views
  // (Settings → Integrations → Avoid duplicates).
  const events = useMemo(() => {
    const live = allEvents.filter((e) => !e.deleted).sort((a, b) => (a.source === b.source ? 0 : a.source === "google" ? -1 : 1));
    const own = schedules.map((x) => scheduleAsEvent(x, colorHex(users[x.owner]?.color || PEOPLE[x.owner].color, dark)));
    return [...own, ...(avoidDuplicates ? dedupeEvents(live) : live)];
  }, [allEvents, schedules, users, dark, avoidDuplicates]);
  const today = useToday();
  const openDetail = useSheets((s) => s.openDetail);
  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    const from = startOfDayMs(addDaysKey(today, -365), viewerTz);
    const to = startOfDayMs(addDaysKey(today, 365), viewerTz);
    const byDay = new Map<DateKey, (TaskOccurrence | EventOccurrence)[]>();
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
    // Schedules too (not in the Completed filter: schedules are not completed).
    if (filter === "all") {
      for (const ev of events) {
        if (!(matches(ev.title, needle) || matches(ev.notes, needle) || matches(ev.location, needle))) continue;
        for (const occ of expandEvent(ev, from, to)) {
          if (!matches(occ.title, needle) && !matches(ev.notes, needle) && !matches(ev.location, needle)) continue;
          const day = eventDays(occ, viewerTz)[0];
          let list = byDay.get(day);
          if (!list) byDay.set(day, (list = []));
          list.push(occ);
          if (++count >= MAX_RESULTS * 2) break;
        }
      }
    }
    for (const list of byDay.values()) list.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start));
    const days = Array.from(byDay.keys()).sort();
    const upcoming = days.filter((d) => d >= today);
    const past = days.filter((d) => d < today).reverse();
    return { days: [...upcoming, ...past], byDay, routines: routines.filter((s) => matches(s.title, needle)) };
  }, [needle, tasks, routines, events, today, filter, showCompleted]);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg, paddingTop: insets.top + 10 }]}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: colors.fill3 }]}>
          <Icon name="magnifyingglass" size={17} color={colors.label2} />
          <TextInput defaultValue={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.label3} autoFocus returnKeyType="search" clearButtonMode="while-editing" style={[styles.input, { color: colors.label }]} />
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
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
        {results === null ? (
          <Text style={[styles.hint, { color: colors.label2 }]}>Search tasks, schedules and routines for 구야 and 은비.</Text>
        ) : results.days.length === 0 && results.routines.length === 0 ? (
          <Text style={[styles.hint, { color: colors.label2, fontSize: 17 }]}>No Results</Text>
        ) : (
          <>
            {results.routines.length ? (
              <View>
                <Text style={[styles.section, { color: colors.label2 }]}>ROUTINES</Text>
                {results.routines.map((s) => (
                  <RoutineRow
                    key={s.id}
                    routine={s}
                    onOpen={() => {
                      openDetail({ kind: "routine", routineId: s.id, dateKey: today >= s.startDate ? today : s.startDate });
                      router.push("/sheet/detail");
                    }}
                  />
                ))}
              </View>
            ) : null}
            {results.days.map((day) => {
              const isToday = day === today;
              return (
                <View key={day}>
                  <Text style={[styles.dayHead, { color: isToday ? colors.red : colors.label, borderBottomColor: colors.separator }]}>
                    {dayHeading(day)}
                    {day.slice(0, 4) !== today.slice(0, 4) ? `, ${day.slice(0, 4)}` : ""}
                  </Text>
                  {results.byDay.get(day)!.map((occ) => (occ.kind === "event" ? <EventRow key={occ.key} occ={occ} day={day} /> : <TaskRow key={occ.key} occ={occ} day={day} />))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function RoutineRow({ routine, onOpen }: { routine: Routine; onOpen: () => void }) {
  const colors = useColors();
  const person = usePerson(routine.owner);
  const color = usePersonColor(routine.owner);
  const s = parseHHmm(routine.startTime);
  const e = parseHHmm(routine.endTime);
  return (
    <Pressable onPress={onOpen} style={[styles.schedRow, { borderBottomColor: colors.separator }]}>
      <Text style={styles.schedIcon}>{routine.icon}</Text>
      <View style={[styles.schedBar, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.schedTitle, { color: colors.label }]}>
          {routine.title}
        </Text>
        <Text numberOfLines={1} style={[styles.schedSub, { color: colors.label2 }]}>
          {person.name} · {describeRule(routine.rrule)} · {formatHM(s.h, s.min)} – {formatHM(e.h, e.min)}
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
  dayHead: { marginHorizontal: 12, paddingHorizontal: 5, paddingTop: 22, paddingBottom: 12, fontSize: 21, fontWeight: "600", borderBottomWidth: StyleSheet.hairlineWidth },
  schedRow: { marginLeft: 16, paddingRight: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  schedIcon: { width: 74, textAlign: "right", fontSize: 24 },
  schedBar: { width: 4, height: 34, borderRadius: 2 },
  schedTitle: { fontSize: 17, lineHeight: 22 },
  schedSub: { fontSize: 15, lineHeight: 19 },
});
