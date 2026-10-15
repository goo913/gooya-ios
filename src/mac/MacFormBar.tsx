import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors, useIsDark } from "@/theme";

/**
 * The foot of a form on the Mac (the popover's, the Day view's pane's): Cancel, and Add or Done in the accent colour, at
 * the right as macOS's dialogs have them. Return and Escape save too, as does a click elsewhere; Cancel leaves it unsaved.
 */
export function MacFormBar({ onCancel, onDone, doneLabel, doneDisabled }: { onCancel: () => void; onDone: () => void; doneLabel: string; doneDisabled?: boolean }) {
  const colors = useColors();
  const dark = useIsDark();
  return (
    <View style={[styles.bar, { borderTopColor: colors.separator }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={({ pressed }) => [styles.button, { backgroundColor: dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.07)" }, pressed && styles.pressed]}>
        <Text allowFontScaling={false} style={[styles.text, { color: colors.label }]}>
          Cancel
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={doneLabel}
        accessibilityState={{ disabled: !!doneDisabled }}
        disabled={doneDisabled}
        onPress={onDone}
        style={({ pressed }) => [styles.button, styles.done, { backgroundColor: colors.blue }, doneDisabled && styles.disabled, pressed && styles.pressed]}
      >
        <Text allowFontScaling={false} style={[styles.text, styles.doneText]}>
          {doneLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  button: { minWidth: 72, height: 24, paddingHorizontal: 12, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  done: { minWidth: 72 },
  text: { fontSize: 13 },
  doneText: { color: "#ffffff", fontWeight: "500" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
