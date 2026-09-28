import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/theme";

export function Problem({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.label }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }, text: { fontSize: 16, textAlign: "center", lineHeight: 22 } });
