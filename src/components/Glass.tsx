import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { PILL_H, useColors } from "@/theme";

const glass = isLiquidGlassAvailable();

/** A floating Liquid Glass capsule (iOS 26's own material; a translucent fill where it is not available). */
export function GlassCapsule({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  if (glass) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={[styles.capsule, style]}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.capsule, { backgroundColor: colors.glassTint, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassRim }, style]}>{children}</View>;
}

interface PillProps {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** A single floating pill button (e.g. "Today", "‹ 2026"). */
export function GlassPill({ children, onPress, label, style }: PillProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => void Haptics.selectionAsync()} style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassCapsule style={[styles.pill, style]}>{children}</GlassCapsule>
    </Pressable>
  );
}

/** Text inside a pill, at the chrome's size. */
export function PillText({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const colors = useColors();
  return <Text style={[styles.pillText, { color: dim ? colors.label2 : colors.label }]}>{children}</Text>;
}

/** A floating capsule containing several icon buttons. */
export function GlassGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <GlassCapsule style={[styles.group, style]}>{children}</GlassCapsule>;
}

interface IconButtonProps {
  children: ReactNode;
  onPress?: () => void;
  label: string;
  width?: number;
}

/** A tap target inside a GlassGroup. */
export function GlassIconButton({ children, onPress, label, width = 60 }: IconButtonProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => void Haptics.selectionAsync()} style={({ pressed }) => [styles.icon, { width }, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: { borderRadius: 999, overflow: "hidden" },
  pill: { height: PILL_H, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  pillText: { fontSize: 21, fontWeight: "400", lineHeight: 26 },
  group: { height: PILL_H, flexDirection: "row", alignItems: "stretch" },
  icon: { alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
});
