import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Group, Row } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { ListBadge } from "@/components/ListIcons";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import type { TaskList } from "@shared/model";
import { otherPerson } from "@shared/people";
import { isReminderList } from "@shared/reminders";
import { useMe, usePerson } from "@/lib/people";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

/**
 * Choose a list for a task (Reminders style); can create a new one. GOOYA's own lists first, then each person's Apple
 * Reminders lists (a task put there becomes one of their reminders). Lists Reminders keeps read-only are left out.
 */
export default function ListPickerSheet() {
  const colors = useColors();
  const lists = useData((s) => s.lists);
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const req = usePickers((s) => s.list);
  const row = (l: TaskList) => (
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
  );
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="List" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      {/* Not the sheet's own scroll view (a form sheet would size that one over the bar): laid out under the bar. */}
      <View collapsable={false} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content}>
          {[mine, other].map((p) => {
            const theirs = lists.filter((l) => isReminderList(l) && l.owner === p.key && !l.readOnly);
            return theirs.length ? (
              <Group key={p.key} header={p.key === me ? "My Reminders" : `${p.name}’s Reminders`} footer={`Added to ${p.key === me ? "your" : `${p.name}’s`} Apple Reminders too.`}>
                {theirs.map(row)}
              </Group>
            ) : null;
          })}
          <Group header="GOOYA">
            {lists.filter((l) => !isReminderList(l)).map((l) => (
              row(l)
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: 40, gap: 20 },
  inline: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 17 },
  plus: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
