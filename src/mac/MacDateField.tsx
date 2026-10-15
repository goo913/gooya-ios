import type { DateKey } from "@shared/model";
import { Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "@/components/Icon";
import { formatMediumDate } from "@/lib/format";
import { useColors, useIsDark } from "@/theme";

/** A day on the Mac ("Oct 24, 2026"): a click opens the month under its row (MonthPicker), as the Date row's does. */
export function MacDateField({ value, open, onOpen, label = "Date" }: { value: DateKey; open: boolean; onOpen: (open: boolean) => void; label?: string }) {
  const colors = useColors();
  const dark = useIsDark();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatMediumDate(value, true)}`}
      onPress={() => onOpen(!open)}
      style={[styles.box, { backgroundColor: dark ? "rgba(255,255,255,0.08)" : "#ffffff", borderColor: open ? colors.blue : dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)" }]}
    >
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.text, { color: colors.label }]}>
        {formatMediumDate(value, true)}
      </Text>
      <Icon name={open ? "chevron.up" : "chevron.down"} size={9} weight="semibold" color={colors.label2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, borderRadius: 6, borderWidth: 1, paddingLeft: 7, paddingRight: 6 },
  text: { fontSize: 13, fontVariant: ["tabular-nums"] },
});
