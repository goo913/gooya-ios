import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { CATEGORY_COLORS } from "@shared/categories";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Apple's list colours as circles (Reminders' New List), the chosen one ringed; under them any other colour, from the
 * system colour picker.
 */
export function ColorSwatches({ value, onChange }: { value: string | null; onChange: (hex: string) => void }) {
  const colors = useColors();
  const custom = !!value && !CATEGORY_COLORS.some((c) => same(c.hex, value));
  return (
    <View>
      <View style={styles.grid}>
        {CATEGORY_COLORS.map((c) => {
          const on = same(c.hex, value);
          return (
            <Pressable key={c.hex} accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: on }} onPress={() => onChange(c.hex)} style={[styles.ring, { borderColor: on ? colors.label3 : "transparent" }]}>
              <View style={[styles.swatch, { backgroundColor: c.hex }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.other, { borderTopColor: colors.separator }]}>
        <Text style={[styles.otherText, { color: colors.label }]}>Other Color</Text>
        {custom ? <ColorDot color={value!} size={22} /> : null}
        <View style={styles.well}>
          <Host matchContents>
            <ColorPicker selection={value ?? CATEGORY_COLORS[6].hex} supportsOpacity={false} onSelectionChange={(c) => onChange(c.slice(0, 7).toLowerCase())} />
          </Host>
        </View>
      </View>
    </View>
  );
}

/** A small filled circle in a colour (a category in a row). */
export function ColorDot({ color, size = 12 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** "Groceries" with its colour, for a row's value. */
export function CategoryValue({ name, color, dim }: { name: string; color: string | null; dim?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.value}>
      {color ? <ColorDot color={color} size={11} /> : null}
      <Text numberOfLines={1} style={[styles.valueText, { color: dim ? colors.label3 : colors.label2 }]}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 14 },
  ring: { width: 46, height: 46, borderRadius: 23, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  well: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  other: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, marginLeft: 16, paddingLeft: 0 },
  otherText: { fontSize: 17, flex: 1 },
  value: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  valueText: { fontSize: 17, flexShrink: 1 },
});
