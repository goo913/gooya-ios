import type { EventOccurrence, TaskOccurrence } from "@shared/model";
import { useId } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { mix, readableTint } from "@/lib/color";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { useTaskColor } from "@/lib/people";
import { usePrefs } from "@/store/prefs";
import { useColors, useIsDark } from "@/theme";
import { isMac } from "../../modules/gooya-mac";

/**
 * Month-view chips, as Apple Calendar draws them: a short rounded bar the width of the day, the title clipped at the
 * right edge with a fade (never "…"), a Reminders-style ring for tasks (a ring with a dot once done, the title dimmed),
 * and the calendar's colour for imported events.
 */

/** The chips' sizes; on the Mac scaled by View → Zoom In and Out (what is on the calendar only). */
export function useChipMetrics(): Metrics {
  const m = useMetrics();
  const z = usePrefs((s) => s.itemZoom);
  if (!isMac || z === 1) return m;
  return { ...m, chipHeight: Math.round(m.chipHeight * z), chipText: m.chipText * z, chipRing: m.chipRing * z, chipRadius: m.chipRadius * z };
}

/** Fades the end of a clipped title into the chip's own colour. */
function EdgeFade({ color, height }: { color: string; height: number }) {
  const id = `fade${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <Svg pointerEvents="none" width={10} height={height} style={styles.fade}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={0} />
          <Stop offset="1" stopColor={color} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={10} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/** A Reminders ring: empty while open, a ring with a dot once completed. */
export function TaskRing({ color, done, size }: { color: string; done: boolean; size: number }) {
  const stroke = Math.max(1.5, size * 0.14);
  const dot = size * 0.52;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color, alignItems: "center", justifyContent: "center" }}>
      {done ? <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} /> : null}
    </View>
  );
}

/** A task on a month cell or the all-day strip: the ring in its category's colour, and the title. */
export function TaskChip({ occ }: { occ: TaskOccurrence }) {
  const colors = useColors();
  const dark = useIsDark();
  const m = useChipMetrics();
  const color = useTaskColor(occ.task);
  const bg = dark ? "#2c2c2e" : "#e9e9ee";
  return (
    <View style={[styles.chip, { height: m.chipHeight, borderRadius: m.chipRadius, backgroundColor: bg, paddingLeft: 2.3, gap: 4.8 * m.grid }]}>
      <TaskRing color={color} done={occ.completed} size={m.chipRing} />
      <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={[styles.text, { fontSize: m.chipText, color: occ.completed ? colors.label2 : colors.label }]}>
        {occ.title}
      </Text>
      <EdgeFade color={bg} height={m.chipHeight} />
    </View>
  );
}

/**
 * Something on several days, as one bar across them: tinted like its chip, the title at the start of each week's part,
 * square where it goes on into the week before or after (flush with the day's edge).
 */
export function EventBar({ occ, openStart, openEnd }: { occ: EventOccurrence; openStart: boolean; openEnd: boolean }) {
  const dark = useIsDark();
  const colors = useColors();
  const m = useChipMetrics();
  const c = occ.event.color || colors.blue;
  const bg = dark ? mix(c, "#000000", 0.27) : mix(c, "#ffffff", 0.2);
  const r = m.chipRadius;
  return (
    <View
      style={[
        styles.chip,
        { height: m.chipHeight, backgroundColor: bg, paddingLeft: openStart ? 4 : 2.7, borderTopLeftRadius: openStart ? 0 : r, borderBottomLeftRadius: openStart ? 0 : r, borderTopRightRadius: openEnd ? 0 : r, borderBottomRightRadius: openEnd ? 0 : r },
      ]}
    >
      <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={[styles.text, { fontSize: m.chipText, color: readableTint(c, dark) }]}>
        {occ.title}
      </Text>
      <EdgeFade color={bg} height={m.chipHeight} />
    </View>
  );
}

/** An imported event: tinted with its calendar's colour, the title in that colour. */
export function EventChip({ occ }: { occ: EventOccurrence }) {
  const colors = useColors();
  const dark = useIsDark();
  const m = useChipMetrics();
  const c = occ.event.color || colors.blue;
  const bg = dark ? mix(c, "#000000", 0.27) : mix(c, "#ffffff", 0.2);
  const text = readableTint(c, dark);
  return (
    <View style={[styles.chip, { height: m.chipHeight, borderRadius: m.chipRadius, backgroundColor: bg, paddingLeft: 2.7 }]}>
      <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={[styles.text, { fontSize: m.chipText, color: text }]}>
        {occ.title}
      </Text>
      <EdgeFade color={bg} height={m.chipHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { width: "100%", flexDirection: "row", alignItems: "center", overflow: "hidden" },
  text: { fontWeight: "600", flexShrink: 1, flexGrow: 1 },
  fade: { position: "absolute", right: 0, top: 0 },
});
