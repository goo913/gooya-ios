import type { EventOccurrence, TaskOccurrence } from "@shared/model";
import { StyleSheet, Text, View } from "react-native";
import { mix, tintText } from "@/lib/color";
import { usePersonColor } from "@/lib/people";
import { useColors, useIsDark } from "@/theme";
import { SourceBadge } from "./SourceBadge";

/** A task on a month cell or the all-day strip: the owner's ring (filled when done) and the title. */
export function TaskChip({ occ }: { occ: TaskOccurrence }) {
  const colors = useColors();
  const color = usePersonColor(occ.task.owner);
  return (
    <View style={[styles.chip, { backgroundColor: colors.fill3 }]}>
      <View style={[styles.ring, { borderColor: color, backgroundColor: occ.completed ? color : "transparent" }]} />
      <Text numberOfLines={1} style={[styles.chipText, { color: occ.completed ? colors.label3 : colors.label }]}>
        {occ.title}
      </Text>
    </View>
  );
}

/** Imported event chip: tinted with the source calendar's colour plus a small source badge. */
export function EventChip({ occ }: { occ: EventOccurrence }) {
  const colors = useColors();
  const dark = useIsDark();
  const c = occ.event.color;
  const text = tintText(c, dark);
  return (
    <View style={[styles.chip, { backgroundColor: mix(c, colors.bg3, dark ? 0.32 : 0.22), paddingRight: 4 }]}>
      <Text numberOfLines={1} style={[styles.chipText, { color: text, flex: 1 }]}>
        {occ.title}
      </Text>
      <SourceBadge source={occ.event.source} size={10} color={text} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { height: 18, width: "100%", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 5, paddingLeft: 4, paddingRight: 3 },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  chipText: { fontSize: 13, fontWeight: "600", lineHeight: 15, flexShrink: 1 },
});
