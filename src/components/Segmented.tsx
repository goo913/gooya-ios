import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useColors, useIsDark } from "@/theme";

interface Option<T> {
  value: T;
  label: string;
}

/** The system segmented control's look: a sliding thumb inside a filled capsule. */
export function Segmented<T extends string>({ options, value, onChange, style }: { options: Option<T>[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const dark = useIsDark();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useRef(new Animated.Value(0)).current;
  const segW = width ? (width - 4) / options.length : 0;
  useEffect(() => {
    Animated.spring(x, { toValue: index * segW, useNativeDriver: true, stiffness: 500, damping: 40, mass: 1 }).start();
  }, [index, segW, x]);
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={[styles.track, { backgroundColor: colors.fill3 }, style]}>
      {width ? <Animated.View style={[styles.thumb, { width: segW, backgroundColor: dark ? "#636366" : "#ffffff", transform: [{ translateX: x }] }]} /> : null}
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)} style={styles.segment}>
          <Text numberOfLines={1} style={[styles.text, { color: colors.label, fontWeight: o.value === value ? "600" : "500" }]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 32, borderRadius: 9, padding: 2, flexDirection: "row" },
  thumb: { position: "absolute", top: 2, bottom: 2, left: 2, borderRadius: 7, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  segment: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 13 },
});
