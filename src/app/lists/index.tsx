import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { GlassPill } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { ListBadge } from "@/components/ListIcons";
import { useCategories } from "@/lib/categoryOps";
import { SMART, useListOccurrences } from "@/lib/listOccurrences";
import { listIndexOf, useFilteredPeople, useMe, usePerson } from "@/lib/people";
import { categoryOfList, isCategory } from "@shared/categories";
import type { TaskList } from "@shared/model";
import { otherPerson } from "@shared/people";
import { useToday } from "@/lib/useNow";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";

/**
 * Reminders-style lists: the smart lists, then the categories both people share (a category counts its tasks in
 * everyone's Reminders lists for it), then any Reminders list that is in no category.
 */
export default function ListsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const people = useFilteredPeople();
  const today = useToday();
  const lists = useData((s) => s.lists);
  const categories = useCategories();
  const occ = useListOccurrences(people, today);
  const showCompleted = usePerson(me).settings.showCompleted;
  const openEditor = useSheets((s) => s.openEditor);
  const counts = useMemo(() => {
    const open = occ.filter((o) => !o.completed);
    const byId = listIndexOf(lists);
    const byList = new Map<string, number>();
    for (const o of open) {
      const key = categoryOfList(o.task.listId, byId)?.id ?? o.task.listId;
      byList.set(key, (byList.get(key) ?? 0) + 1);
    }
    return {
      today: open.filter((o) => o.dueDate && o.dueDate <= today).length,
      scheduled: open.filter((o) => !!o.dueDate).length,
      all: open.length,
      completed: occ.filter((o) => o.completed).length,
      byList,
    };
  }, [occ, lists, today]);
  const newTask = () => {
    openEditor({ kind: "task", initialOwner: me });
    router.push("/sheet/edit");
  };
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 58, paddingHorizontal: 16, paddingBottom: insets.bottom + 150 }} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {SMART.filter((s) => s.key !== "completed" || showCompleted || counts.completed > 0).map((s) => (
            <Pressable key={s.key} onPress={() => router.push({ pathname: "/lists/[id]", params: { id: `smart:${s.key}` } })} style={[styles.smart, { backgroundColor: colors.bg3 }]}>
              <View style={styles.smartTop}>
                <View style={[styles.smartIcon, { backgroundColor: s.color }]}>
                  <Icon name={s.icon as never} size={17} color="#ffffff" weight="semibold" />
                </View>
                <Text style={[styles.smartCount, { color: colors.label }]}>{counts[s.key]}</Text>
              </View>
              <Text style={[styles.smartLabel, { color: colors.label2 }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.h2, { color: colors.label }]}>Categories</Text>
        <ListCard lists={categories} counts={counts.byList} />
        <Pressable
          onPress={() => {
            usePickers.getState().setList(null);
            router.push("/sheet/listEdit");
          }}
          style={styles.add}
        >
          <Icon name="plus" size={16} color={colors.blue} weight="semibold" />
          <Text style={[styles.addText, { color: colors.blue }]}>Add Category</Text>
        </Pressable>
        {[mine, other].map((p) => {
          // A Reminders list in no category (its category was deleted): its tasks are still somewhere to find.
          const loose = lists.filter((l) => !isCategory(l) && l.owner === p.key && !categoryOfList(l.id, listIndexOf(lists)));
          if (!loose.length) return null;
          return (
            <View key={p.key}>
              <Text style={[styles.h2, { color: colors.label }]}>{p.key === me ? "My Other Reminders Lists" : `${p.name}’s Other Reminders Lists`}</Text>
              <ListCard lists={loose} counts={counts.byList} />
            </View>
          );
        })}
      </ScrollView>
      <TopChrome back="Calendar" onBack={() => router.back()} onAdd={newTask} onSearch={() => router.push("/search")} />
      <BottomChrome
        showToday={false}
        left={
          <GlassPill label="New Task" onPress={newTask} style={{ paddingHorizontal: 18 }}>
            <Icon name="plus" size={20} color={colors.blue} weight="semibold" />
            <Text style={[styles.newTask, { color: colors.blue }]}>New Task</Text>
          </GlassPill>
        }
        onSettings={() => router.push("/settings")}
        onCalendars={() => router.push("/calendars")}
      />
    </View>
  );
}

function ListCard({ lists, counts }: { lists: TaskList[]; counts: Map<string, number> }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.bg3 }]}>
      {lists.map((l, i) => (
        <Pressable key={l.id} onPress={() => router.push({ pathname: "/lists/[id]", params: { id: l.id } })} style={[styles.listRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
          <ListBadge icon={l.icon} color={l.color} size={32} />
          <View style={styles.listText}>
            <Text style={[styles.listName, { color: colors.label }]}>{l.name}</Text>
            {l.readOnly ? <Text style={[styles.listNote, { color: colors.label2 }]}>Read-only in Reminders</Text> : null}
          </View>
          <Text style={[styles.listCount, { color: colors.label2 }]}>{counts.get(l.id) ?? 0}</Text>
          <Icon name="chevron.right" size={14} color={colors.label3} weight="semibold" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  smart: { width: "48%", borderRadius: 14, padding: 12, gap: 8 },
  smartTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  smartIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  smartCount: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  smartLabel: { fontSize: 15, fontWeight: "600" },
  h2: { marginTop: 28, marginBottom: 8, paddingHorizontal: 4, fontSize: 22, fontWeight: "700" },
  card: { borderRadius: 14, overflow: "hidden" },
  listRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  listText: { flex: 1 },
  listName: { fontSize: 17 },
  listNote: { fontSize: 13, marginTop: 1 },
  listCount: { fontSize: 17, fontVariant: ["tabular-nums"] },
  add: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  addText: { fontSize: 17, fontWeight: "600" },
  newTask: { fontSize: 19, fontWeight: "600" },
});
