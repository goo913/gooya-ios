import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useMetrics } from "@/lib/metrics";
import { useColors } from "@/theme";

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
  /** 44 at the top of a screen, 48 at the bottom, as Apple's bars are. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** A single floating pill button (e.g. "Today", "‹ 2026"). */
export function GlassPill({ children, onPress, label, height, style }: PillProps) {
  const m = useMetrics();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => void Haptics.selectionAsync()} hitSlop={4} style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassCapsule style={[styles.pill, { height: height ?? m.barHeight }, style]}>{children}</GlassCapsule>
    </Pressable>
  );
}

/** Text inside a pill, at the bars' size (it follows Text Size fully, as Apple's bar buttons do). */
export function PillText({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const colors = useColors();
  const m = useMetrics();
  return (
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.pillText, { fontSize: m.barText, color: dim ? colors.label2 : colors.label }]}>
      {children}
    </Text>
  );
}

/** A floating capsule containing several icon buttons. */
export function GlassGroup({ children, height, style }: { children: ReactNode; height?: number; style?: StyleProp<ViewStyle> }) {
  const m = useMetrics();
  return <GlassCapsule style={[styles.group, { height: height ?? m.barHeight }, style]}>{children}</GlassCapsule>;
}

interface IconButtonProps {
  children: ReactNode;
  onPress?: () => void;
  label: string;
  width?: number;
}

/** A tap target inside a GlassGroup. */
export function GlassIconButton({ children, onPress, label, width }: IconButtonProps) {
  const m = useMetrics();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => void Haptics.selectionAsync()} style={({ pressed }) => [styles.icon, { width: width ?? m.barButtonWidth }, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: { borderRadius: 999, overflow: "hidden" },
  pill: { paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  pillText: { fontWeight: "400" },
  group: { flexDirection: "row", alignItems: "stretch" },
  icon: { alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
});
