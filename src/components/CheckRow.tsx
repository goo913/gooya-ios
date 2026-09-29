import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";
import { Icon } from "./Icon";

/**
 * A row with Apple's round tick in a calendar's (or person's) colour, as in Apple Calendar's Calendars sheet: filled
 * with a white check when on, an empty ring when off. `divider` draws the hairline above it (lists not in a Group).
 */
export function CheckRow({ color, checked, onPress, title, subtitle, divider }: { color: string; checked: boolean; onPress: () => void; title: string; subtitle?: string; divider?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill4 }]}
    >
      <View style={[styles.check, checked ? { backgroundColor: color } : { borderWidth: 2, borderColor: colors.label3 }]}>{checked ? <Icon name="checkmark" size={13} weight="bold" color="#ffffff" /> : null}</View>
      <View style={[styles.text, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
        <Text style={[styles.title, { color: colors.label }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.label2 }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 16, paddingRight: 18 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, alignSelf: "stretch", justifyContent: "center", paddingVertical: 14 },
  title: { fontSize: 17 },
  subtitle: { fontSize: 15, marginTop: 1 },
});
