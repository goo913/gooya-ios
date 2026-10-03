import type { TaskList } from "@shared/model";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Group, Row } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { ListBadge } from "@/components/ListIcons";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { useCategories } from "@/lib/categoryOps";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

/**
 * Choose a category for a task or a schedule; a new one can be made here. The categories are both people's; for whoever
 * syncs Apple Reminders a task's category is also its list there.
 */
export default function CategoryPickerSheet() {
  const colors = useColors();
  const categories = useCategories();
  const req = usePickers((s) => s.list);
  const pick = (id: string | null) => {
    req?.onPick(id);
    router.back();
  };
  const row = (l: TaskList) => (
    <Row
      key={l.id}
      accessibilityLabel={l.name}
      label={
        <View style={styles.inline}>
          <ListBadge icon={l.icon} color={l.color} size={28} />
          <Text style={[styles.name, { color: colors.label }]}>{l.name}</Text>
        </View>
      }
      onPress={() => pick(l.id)}
    >
      {l.id === req?.value ? <Icon name="checkmark" size={18} color={colors.blue} weight="semibold" /> : null}
    </Row>
  );
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Category" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      {/* Not the sheet's own scroll view (a form sheet would size that one over the bar): laid out under the bar. */}
      <View collapsable={false} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content}>
          <Group footer="A task's circle and a schedule's color are its category's. For whoever syncs Apple Reminders, a task's category is also its list there, in the same color.">
            {req?.allowNone ? (
              <Row
                accessibilityLabel="None"
                label={
                  <View style={styles.inline}>
                    <View style={[styles.none, { borderColor: colors.label3 }]} />
                    <Text style={[styles.name, { color: colors.label }]}>None</Text>
                  </View>
                }
                onPress={() => pick(null)}
              >
                {req.value == null ? <Icon name="checkmark" size={18} color={colors.blue} weight="semibold" /> : null}
              </Row>
            ) : null}
            {categories.map(row)}
            <Row
              accessibilityLabel="New Category"
              label={
                <View style={styles.inline}>
                  <View style={[styles.plus, { backgroundColor: colors.fill3 }]}>
                    <Icon name="plus" size={16} color={colors.blue} weight="semibold" />
                  </View>
                  <Text style={[styles.name, { color: colors.blue }]}>New Category…</Text>
                </View>
              }
              onPress={() => router.push("/sheet/listEdit")}
            />
          </Group>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: 40, paddingTop: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 17 },
  plus: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  none: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed" },
});
