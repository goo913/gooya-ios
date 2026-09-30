import type { TaskOccurrence } from "@shared/model";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatTime } from "@/lib/format";
import { usePerson, useTaskColor } from "@/lib/people";
import { setCompleted } from "@/lib/taskOps";
import { viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useColors } from "@/theme";
import { Icon } from "./Icon";

const BANGS = ["", "!", "!!", "!!!"];

/** List/search row for a task occurrence, Apple list style. */
export function OccurrenceRow({ occ, onOpen, showDate }: { occ: TaskOccurrence; onOpen: () => void; showDate?: string }) {
  const colors = useColors();
  const person = usePerson(occ.task.owner);
  const color = useTaskColor(occ.task);
  const list = useData((s) => s.lists.find((l) => l.id === occ.task.listId));
  const firstNote = occ.notes.split("\n").find((l) => l.trim()) ?? "";
  return (
    <View style={[styles.row, { borderBottomColor: colors.separator }]}>
      <Pressable onPress={onOpen} style={styles.main}>
        <View style={styles.time}>
          {/* A task without a date has no time to show (Apple Reminders shows nothing there either). */}
          <Text style={[styles.timeText, { color: occ.allDay ? colors.label2 : colors.label }]}>{!occ.task.dueDate ? "" : occ.allDay ? "all-day" : formatTime(occ.start, viewerTz)}</Text>
          {showDate ? <Text style={[styles.date, { color: colors.label3 }]}>{showDate}</Text> : null}
        </View>
        <View style={[styles.bar, { backgroundColor: color }]} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, { color: occ.completed ? colors.label3 : colors.label }, occ.completed && styles.strike]}>
            {occ.task.priority ? <Text style={{ color: colors.orange }}>{BANGS[occ.task.priority]} </Text> : null}
            {occ.title}
            {occ.task.flagged ? "  ⚑" : ""}
          </Text>
          <Text numberOfLines={1} style={[styles.sub, { color: colors.label2 }]}>
            {person.name}
            {list && list.id !== "tasks" ? ` · ${list.name}` : ""}
            {firstNote ? ` · ${firstNote}` : ""}
            {occ.task.tags?.length ? ` · ${occ.task.tags.map((t) => `#${t}`).join(" ")}` : ""}
          </Text>
        </View>
      </Pressable>
      <Pressable accessibilityLabel={occ.completed ? "Mark incomplete" : "Mark complete"} onPress={() => void setCompleted(occ.task, occ.dateKey, !occ.completed)} hitSlop={8} style={styles.check}>
        <Icon name={occ.completed ? "checkmark.circle.fill" : "circle"} size={24} color={color} weight="light" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginLeft: 16, paddingRight: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  time: { width: 74, alignItems: "flex-end", paddingTop: 1 },
  timeText: { fontSize: 15, lineHeight: 19, fontVariant: ["tabular-nums"] },
  date: { fontSize: 12, lineHeight: 15 },
  bar: { width: 4, height: 34, borderRadius: 2, marginTop: 2 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22 },
  strike: { textDecorationLine: "line-through" },
  sub: { fontSize: 15, lineHeight: 19 },
  check: { paddingVertical: 8 },
});
