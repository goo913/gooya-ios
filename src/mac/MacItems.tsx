import type { EventOccurrence, TaskOccurrence } from "@shared/model";
import { StyleSheet, Text, View } from "react-native";
import { TaskRing } from "@/components/Chips";
import { mix } from "@/lib/color";
import { useTaskColor } from "@/lib/people";
import { useIsDark } from "@/theme";
import { ITEM_FONT, useMacColors, type MacColors } from "./theme";

// What is on a day in Apple Calendar's month on the Mac (macOS 27), measured at 1×: lines 18 points apart; a task's
// ring (10.5 points) or a timed event's colour bar (3 × 12) before its title (12 points, regular, "…" where it is cut);
// an all-day event as a capsule of its colour at a quarter over the background, its title in the colour at half
// (light) or brightened (dark); something chosen filled with its colour (a task with blue), the text white. View →
// Zoom In and Out scale all of it (`z`).

type Item = TaskOccurrence | EventOccurrence;

export const LINE = 18;

/** A whole-day event's capsule colours. */
export function capsuleColors(color: string, colors: MacColors, dark: boolean): { fill: string; text: string } {
  return dark ? { fill: mix(color, colors.bg, 0.32), text: mix(color, "#ffffff", 0.55) } : { fill: mix(color, colors.bg, 0.25), text: mix(color, "#000000", 0.5) };
}

/** Whether a click `x` points along a month line is on its ring (with a little room around it). */
export const onRing = (x: number, z: number): boolean => x < (4 + 10.5 + 5) * z;

/** A task, or an event at a time: the ring or the bar, then the title. */
export function MonthLine({ occ, z, selected, active }: { occ: Item; z: number; selected: boolean; active: boolean }) {
  const colors = useMacColors();
  const ring = useTaskColor(occ.kind === "task" ? occ.task : { owner: occ.event.owner, listId: "" });
  const task = occ.kind === "task";
  const color = task ? ring : occ.event.color || colors.accent;
  const done = task && occ.completed;
  const fill = selected ? (active ? (task ? colors.accent : color) : colors.inactive) : undefined;
  return (
    <View style={[styles.line, { height: LINE * z, paddingLeft: 4 * z }, fill ? { backgroundColor: fill, borderRadius: 4 * z } : null]}>
      {task ? (
        <TaskRing color={fill ? "#ffffff" : color} done={done} size={10.5 * z} />
      ) : (
        <View style={[styles.bar, { height: 12 * z, borderRadius: 1.5 * z, backgroundColor: fill ? "#ffffff" : color }]} />
      )}
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { fontSize: ITEM_FONT * z, marginLeft: 4 * z, color: fill ? "#ffffff" : done ? colors.text2 : colors.text }]}>
        {occ.title}
      </Text>
    </View>
  );
}

/** An all-day event: a capsule of its colour; square where it goes on into the week before or after. */
export function MonthCapsule({ occ, z, selected, active, openStart = false, openEnd = false }: { occ: EventOccurrence; z: number; selected: boolean; active: boolean; openStart?: boolean; openEnd?: boolean }) {
  const colors = useMacColors();
  const dark = useIsDark();
  const color = occ.event.color || colors.accent;
  const c = capsuleColors(color, colors, dark);
  const fill = selected ? (active ? color : colors.inactive) : c.fill;
  const r = 4 * z;
  return (
    <View
      style={[
        styles.capsule,
        { height: 16 * z, backgroundColor: fill, paddingHorizontal: 4 * z, borderRadius: r },
        openStart && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
        openEnd && { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
      ]}
    >
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { fontSize: ITEM_FONT * z, color: selected ? "#ffffff" : c.text }]}>
        {occ.title}
      </Text>
    </View>
  );
}

/** A new item's placeholder while its popover is open: chosen-looking ("New Task" until a title is typed). */
export function DraftLine({ kind, title, z, active }: { kind: "task" | "schedule"; title: string; z: number; active: boolean }) {
  const colors = useMacColors();
  return (
    <View style={[styles.line, { height: LINE * z, paddingLeft: 4 * z, backgroundColor: active ? colors.accent : colors.inactive, borderRadius: 4 * z }]}>
      {kind === "task" ? <TaskRing color="#ffffff" done={false} size={10.5 * z} /> : <View style={[styles.bar, { height: 12 * z, borderRadius: 1.5 * z, backgroundColor: "#ffffff" }]} />}
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { fontSize: ITEM_FONT * z, marginLeft: 4 * z, color: "#ffffff" }]}>
        {title.trim() || (kind === "task" ? "New Task" : "New Schedule")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", paddingRight: 4, overflow: "hidden" },
  bar: { width: 3 },
  title: { flex: 1, fontWeight: "400" },
  capsule: { flexDirection: "row", alignItems: "center", marginTop: 1, overflow: "hidden" },
});
