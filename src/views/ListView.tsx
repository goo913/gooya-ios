import { addDaysKey, parseKey, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OccurrenceRow } from "@/components/OccurrenceRow";
import { MONTH_SHORT, WEEKDAY_LONG } from "@/lib/format";
import { useTasksByDay } from "@/lib/occurrences";
import { useFilteredPeople } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";

const PAST_DAYS = 14;
const FUTURE_DAYS = 120;

/** Apple's List display: upcoming tasks grouped by day. */
export function ListView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const people = useFilteredPeople();
  const todayNonce = useNav((s) => s.todayNonce);
  const openEditor = useSheets((s) => s.openEditor);
  const start = useMemo(() => startOfDayMs(addDaysKey(today, -PAST_DAYS), viewerTz), [today]);
  const end = useMemo(() => startOfDayMs(addDaysKey(today, FUTURE_DAYS), viewerTz), [today]);
  const byDay = useTasksByDay(start, end, people, viewerTz);
  const days = useMemo(() => Array.from(byDay.keys()).filter((k) => k >= addDaysKey(today, -PAST_DAYS)).sort(), [byDay, today]);
  const scrollRef = useRef<ScrollView>(null);
  const todayY = useRef(0);
  const firstFuture = days.find((d) => d >= today);
  useEffect(() => {
    if (todayNonce > 0) scrollRef.current?.scrollTo({ y: todayY.current, animated: true });
  }, [todayNonce]);
  return (
    <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={{ paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
      {days.length === 0 ? <Text style={[styles.empty, { color: colors.label2 }]}>No Tasks</Text> : null}
      {days.map((day) => {
        const { y, m, d } = parseKey(day);
        const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const isToday = day === today;
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
            <View style={styles.dayHead}>
              <Text style={[styles.dayName, { color: isToday ? colors.red : colors.label }]}>{WEEKDAY_LONG[wd]}</Text>
              <Text style={[styles.dayDate, { color: isToday ? colors.red : colors.label2 }]}>
                {MONTH_SHORT[m - 1]} {d}
                {isToday ? " · Today" : ""}
              </Text>
            </View>
            {(byDay.get(day) ?? []).map((occ) => (
              <OccurrenceRow
                key={occ.key}
                occ={occ}
                onOpen={() => {
                  openEditor({ kind: "task", task: occ.task, occ });
                  router.push("/sheet/edit");
                }}
              />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { paddingHorizontal: 16, paddingTop: 64, textAlign: "center", fontSize: 17 },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  dayName: { fontSize: 17, fontWeight: "600" },
  dayDate: { fontSize: 15 },
});
