import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";
import { GlassCapsule } from "./Glass";
import { Icon } from "./Icon";

/**
 * Sheet title bars as iOS 26/27 draws them (Apple Calendar's Calendars and event sheets, Reminders' Details): 44-point
 * glass buttons 15 points below the sheet's top edge, the title centred between them.
 */
export function SheetBar({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <View style={styles.left}>{left}</View>
      <Text numberOfLines={1} style={[styles.title, { color: colors.label }]}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

/** A text button on glass ("Done", "Edit", "Cancel"). */
export function BarButton({ children, onPress, disabled, bold }: { children: ReactNode; onPress: () => void; disabled?: boolean; bold?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={typeof children === "string" ? children : undefined}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <GlassCapsule style={styles.pill}>
        <Text style={[styles.button, { color: colors.label, fontWeight: bold ? "600" : "400" }]}>{children}</Text>
      </GlassCapsule>
    </Pressable>
  );
}

/** The round glass ✕ that closes a sheet. */
export function CloseButton({ onPress, label = "Close" }: { onPress: () => void; label?: string }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <GlassCapsule style={styles.round}>
        <Icon name="xmark" size={19} weight="semibold" color={colors.label} />
      </GlassCapsule>
    </Pressable>
  );
}

/** Reminders' Details header: the glass ✕ on the left, the title, a filled blue ✓ on the right. */
export function DetailsBar({ title, onCancel, onDone, doneLabel, doneDisabled }: { title: string; onCancel: () => void; onDone: () => void; doneLabel: string; doneDisabled?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <CloseButton onPress={onCancel} label="Cancel" />
      </View>
      <Text numberOfLines={1} style={[styles.title, { color: colors.label }]}>
        {title}
      </Text>
      <View style={styles.right}>
        <Pressable accessibilityRole="button" accessibilityLabel={doneLabel} onPress={onDone} disabled={doneDisabled} hitSlop={6} style={({ pressed }) => ({ opacity: doneDisabled ? 0.4 : pressed ? 0.7 : 1 })}>
          <View style={[styles.round, { backgroundColor: colors.blue }]}>
            <Icon name="checkmark" size={20} color="#ffffff" weight="bold" />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 74, paddingTop: 15, paddingBottom: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 76 },
  left: { position: "absolute", left: 16, top: 15 },
  right: { position: "absolute", right: 16, top: 15 },
  title: { fontSize: 17, fontWeight: "600" },
  pill: { height: 44, paddingHorizontal: 17, alignItems: "center", justifyContent: "center" },
  button: { fontSize: 17 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
