import { StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";

/** Tiny source badge for imported events (Google / Apple). */
export function SourceBadge({ source, size = 11, color }: { source: "google" | "apple"; size?: number; color?: string }) {
  if (source === "google") {
    return (
      <View style={[styles.g, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={{ fontSize: size * 0.72, fontWeight: "700", color: "#4285f4", lineHeight: size }}>G</Text>
      </View>
    );
  }
  return <Icon name="apple.logo" size={size} color={color} />;
}

const styles = StyleSheet.create({ g: { backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" } });
