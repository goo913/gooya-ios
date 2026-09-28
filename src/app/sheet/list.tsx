import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Group, Row } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { ListBadge } from "@/components/ListIcons";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

/** Choose a list for a task (Reminders style); can create a new one. */
export default function ListPickerSheet() {
  const colors = useColors();
  const lists = useData((s) => s.lists);
  const req = usePickers((s) => s.list);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="List" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      <ScrollView contentContainerStyle={styles.content}>
        <Group>
          {lists.map((l) => (
            <Row
              key={l.id}
              label={
                <View style={styles.inline}>
                  <ListBadge icon={l.icon} color={l.color} />
                  <Text style={[styles.name, { color: colors.label }]}>{l.name}</Text>
                </View>
              }
              onPress={() => {
                req?.onPick(l.id);
                router.back();
              }}
            >
              {l.id === req?.value ? <Icon name="checkmark" size={18} color={colors.blue} weight="semibold" /> : null}
            </Row>
          ))}
          <Row
            label={
              <View style={styles.inline}>
                <View style={[styles.plus, { backgroundColor: colors.fill3 }]}>
                  <Icon name="plus" size={16} color={colors.blue} weight="semibold" />
                </View>
                <Text style={[styles.name, { color: colors.blue }]}>New List…</Text>
              </View>
            }
            onPress={() => router.push("/sheet/listEdit")}
          />
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: 40 },
  inline: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 17 },
  plus: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
