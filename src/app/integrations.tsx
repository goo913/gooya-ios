import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Group, Row } from "@/components/Form";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { useColors } from "@/theme";

/** Placeholder until the integrations screen is ported. */
export default function IntegrationsSheet() {
  const colors = useColors();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Integrations" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      <ScrollView contentContainerStyle={styles.content}>
        <Group footer="Google Calendar, iCloud, the Reminders bridge and the subscription feed are coming to the app; until then they are managed on the web.">
          <Row label="Coming soon" />
        </Group>
        <Text style={[styles.note, { color: colors.label3 }]}> </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 }, content: { paddingTop: 4, paddingBottom: 40 }, note: { fontSize: 12 } });
