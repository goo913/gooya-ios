import { categoryOfList } from "@shared/categories";
import { router } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Group, Row } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { ListBadge } from "@/components/ListIcons";
import { CloseButton, SheetBar } from "@/components/SheetHeader";
import { useCategories } from "@/lib/categoryOps";
import { listIndexOf } from "@/lib/people";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Settings → Categories: both people's categories, with what is in each; tap one to change it. */
export default function CategoriesSheet() {
  const colors = useColors();
  const lists = useData((s) => s.lists);
  const categories = useCategories();
  const tasks = useData((s) => s.tasks);
  const schedules = useData((s) => s.schedules);
  const counts = useMemo(() => {
    const byId = listIndexOf(lists);
    const out = new Map<string, { tasks: number; schedules: number }>();
    const bump = (id: string | undefined | null, what: "tasks" | "schedules") => {
      if (!id) return;
      const c = out.get(id) ?? { tasks: 0, schedules: 0 };
      c[what]++;
      out.set(id, c);
    };
    for (const t of tasks) if (!t.completed) bump(categoryOfList(t.listId, byId)?.id, "tasks");
    for (const s of schedules) bump(s.categoryId, "schedules");
    return out;
  }, [lists, tasks, schedules]);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Categories" left={<CloseButton onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Group footer="Both of you share these. A task's circle and a schedule's color are its category's (a schedule can have its own color). For whoever syncs Apple Reminders, each category a task is in is a list there too, with the same name and color, so Apple Calendar shows it that way.">
          {categories.map((l) => {
            const c = counts.get(l.id);
            const what = [c?.tasks ? plural(c.tasks, "task") : null, c?.schedules ? plural(c.schedules, "schedule") : null].filter(Boolean).join(" · ");
            return (
              <Row
                key={l.id}
                accessibilityLabel={l.name}
                label={
                  <View style={styles.inline}>
                    <ListBadge icon={l.icon} color={l.color} size={30} />
                    <View style={styles.text}>
                      <Text style={[styles.name, { color: colors.label }]}>{l.name}</Text>
                      {what ? <Text style={[styles.count, { color: colors.label2 }]}>{what}</Text> : null}
                    </View>
                  </View>
                }
                chevron
                onPress={() => router.push({ pathname: "/sheet/listEdit", params: { id: l.id } })}
              />
            );
          })}
          <Row
            accessibilityLabel="Add Category"
            label={
              <View style={styles.inline}>
                <View style={[styles.plus, { backgroundColor: colors.fill3 }]}>
                  <Icon name="plus" size={16} color={colors.blue} weight="semibold" />
                </View>
                <Text style={[styles.name, { color: colors.blue }]}>Add Category</Text>
              </View>
            }
            onPress={() => {
              // Not choosing for an editor: the new category is only made.
              usePickers.getState().setList(null);
              router.push("/sheet/listEdit");
            }}
          />
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 60 },
  inline: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  text: { flexShrink: 1 },
  name: { fontSize: 17 },
  count: { fontSize: 13, marginTop: 1 },
  plus: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
