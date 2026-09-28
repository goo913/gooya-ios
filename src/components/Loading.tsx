import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useColors } from "@/theme";

export function Loading() {
  const colors = useColors();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.label2} />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, alignItems: "center", justifyContent: "center" } });
