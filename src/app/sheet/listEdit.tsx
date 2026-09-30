import { DEFAULT_CATEGORY_ID, categoryKey, isCategory, sameNamed } from "@shared/categories";
import { PEOPLE } from "@shared/people";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ColorSwatches } from "@/components/ColorSwatches";
import { DestructiveButton, Group, TextRow } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { LIST_ICON_NAMES, ListBadge, listSymbol } from "@/components/ListIcons";
import { DetailsBar } from "@/components/SheetHeader";
import { categoryUse, deleteCategory, mergeCategory, saveCategory } from "@/lib/categoryOps";
import { useMe } from "@/lib/people";
import { syncRemindersSoon } from "@/lib/reminders";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

/** Make or change a category: its name, colour and glyph. Merging (a name another has) and deleting are here too. */
export default function CategoryEditSheet() {
  const colors = useColors();
  const me = useMe();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lists = useData((s) => s.lists);
  const users = useData((s) => s.users);
  const category = id ? lists.find((l) => l.id === id && isCategory(l)) : undefined;
  const picker = usePickers((s) => s.list);
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? "#007aff");
  const [icon, setIcon] = useState(category?.icon ?? "list");
  const inReminders = category ? lists.filter((l) => !isCategory(l) && l.categoryId === category.id && l.owner) : [];

  const finish = (pickedId: string | null) => {
    if (!category && picker && pickedId) {
      picker.onPick(pickedId);
      router.dismissTo("/sheet/edit");
    } else router.back();
  };

  const write = async () => {
    const newListId = await saveCategory(category, { name: name.trim(), color, icon }, me);
    // A new name or colour goes to the Reminders lists that are this category.
    if (inReminders.length) syncRemindersSoon(800);
    finish(newListId);
  };

  const save = () => {
    if (!name.trim()) return;
    const clash = sameNamed(name, lists, category?.id);
    if (!clash) return void write();
    if (!category) {
      Alert.alert(`“${clash.name}” is already a category`, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: `Use “${clash.name}”`, onPress: () => finish(clash.id) },
      ]);
      return;
    }
    const use = categoryUse(category.id);
    const part = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
    const what = [use.tasks ? part(use.tasks, "task") : null, use.schedules ? part(use.schedules, "schedule") : null].filter(Boolean).join(" and ");
    const verb = use.tasks + use.schedules === 1 ? "moves" : "move";
    Alert.alert(`Merge into “${clash.name}”?`, `${what ? `The ${what} in “${category.name}” ${verb} to “${clash.name}”, which keeps its color. ` : ""}“${category.name}” is deleted.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Merge", style: "destructive", onPress: () => void mergeCategory(category.id, clash.id).then(() => router.back()) },
    ]);
  };

  const askDelete = () => {
    if (!category) return;
    const use = categoryUse(category.id);
    const tasksLine = use.tasks === 1 ? "Its task moves to Tasks. " : use.tasks ? `Its ${use.tasks} tasks move to Tasks. ` : "";
    const schedulesLine = use.schedules === 1 ? "Its schedule stays, in no category. " : use.schedules ? `Its ${use.schedules} schedules stay, in no category. ` : "";
    const remindersLine = inReminders.length ? "Its list stays in Apple Reminders (empty), to delete there if you like." : "";
    Alert.alert(`Delete “${category.name}”?`, `${tasksLine}${schedulesLine}${remindersLine}`.trim() || undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Category", style: "destructive", onPress: () => void deleteCategory(category.id).then(() => router.back()) },
    ]);
  };

  const whose = inReminders.map((l) => `${users[l.owner!]?.name || PEOPLE[l.owner!].name}’s`).join(" and ");
  const renamed = !!category && categoryKey(name) !== categoryKey(category.name);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={category ? "Edit Category" : "New Category"} onCancel={() => router.back()} onDone={() => save()} doneLabel="Done" doneDisabled={!name.trim()} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <View style={styles.center}>
          <ListBadge icon={icon} color={color} size={84} />
        </View>
        <Group footer={inReminders.length ? `Also a list in ${whose} Apple Reminders${renamed ? ", renamed there too" : ""}, in this color.` : undefined}>
          <TextRow value={name} onChange={setName} placeholder="Category Name" autoFocus={!category} />
        </Group>
        <Group header="Color">
          <ColorSwatches value={color} onChange={setColor} />
        </Group>
        <Group header="Icon">
          <View style={styles.icons}>
            {LIST_ICON_NAMES.map((n) => (
              <Pressable key={n} accessibilityLabel={n} onPress={() => setIcon(n)} style={[styles.iconButton, { backgroundColor: icon === n ? colors.fill : colors.fill4, borderColor: icon === n ? color : "transparent" }]}>
                <Icon name={listSymbol(n) as never} size={19} />
              </Pressable>
            ))}
          </View>
        </Group>
        {category && category.id !== DEFAULT_CATEGORY_ID ? <DestructiveButton onPress={askDelete}>Delete Category</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 24, paddingTop: 8, paddingBottom: 40 },
  center: { alignItems: "center" },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, paddingVertical: 16, justifyContent: "center" },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
