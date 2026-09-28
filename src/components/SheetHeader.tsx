import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";
import { Icon } from "./Icon";

/** Standard sheet title bar: left action · title · right action. */
export function SheetBar({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <View style={styles.left}>{left}</View>
      <Text style={[styles.title, { color: colors.label }]}>{title}</Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

export function BarButton({ children, onPress, disabled, bold }: { children: ReactNode; onPress: () => void; disabled?: boolean; bold?: boolean }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}>
      <Text style={[styles.button, { color: colors.blue, fontWeight: bold ? "600" : "400" }]}>{children}</Text>
    </Pressable>
  );
}

/** Reminders' Details header: round ✕ on the left, the title, a filled ✓ on the right. */
export function DetailsBar({ title, onCancel, onDone, doneLabel, doneDisabled }: { title: string; onCancel: () => void; onDone: () => void; doneLabel: string; doneDisabled?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.detailsBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={[styles.round, { backgroundColor: colors.fill3, left: 16 }]}>
        <Icon name="xmark" size={17} weight="bold" />
      </Pressable>
      <Text style={[styles.title, { color: colors.label }]}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={doneLabel} onPress={onDone} disabled={doneDisabled} style={[styles.round, { backgroundColor: colors.blue, right: 16, opacity: doneDisabled ? 0.4 : 1 }]}>
        <Icon name="checkmark" size={19} color="#ffffff" weight="bold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  left: { position: "absolute", left: 16 },
  right: { position: "absolute", right: 16 },
  title: { fontSize: 17, fontWeight: "600" },
  button: { fontSize: 17 },
  detailsBar: { height: 60, alignItems: "center", justifyContent: "center" },
  round: { position: "absolute", top: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
