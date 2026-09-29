import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { DestructiveButton, Group, Row, TextRow } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { LIST_ICON_NAMES, ListBadge, listSymbol } from "@/components/ListIcons";
import { DetailsBar } from "@/components/SheetHeader";
import { deleteList, newId, saveList } from "@/lib/db";
import { useMe } from "@/lib/people";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

/** Create or edit a list: name, colour, icon. */
export default function ListEditSheet() {
  const colors = useColors();
  const me = useMe();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lists = useData((s) => s.lists);
  const list = id ? lists.find((l) => l.id === id) : undefined;
  const picker = usePickers((s) => s.list);
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState(list?.color ?? "#0091ff");
  const [icon, setIcon] = useState(list?.icon ?? "list");
  const save = async () => {
    if (!name.trim()) return;
    const now = Date.now();
    const newListId = list?.id ?? newId();
    await saveList({
      id: newListId,
      name: name.trim(),
      color,
      icon,
      order: list?.order ?? (lists.length ? Math.max(...lists.map((l) => l.order)) + 1 : 0),
      createdBy: list?.createdBy ?? me,
      createdAt: list?.createdAt ?? now,
      updatedAt: now,
    });
    if (!list && picker) {
      picker.onPick(newListId);
      router.dismissTo("/sheet/edit");
    } else router.back();
  };
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={list ? "Edit List" : "New List"} onCancel={() => router.back()} onDone={() => void save()} doneLabel="Done" doneDisabled={!name.trim()} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <View style={styles.center}>
          <ListBadge icon={icon} color={color} size={84} />
        </View>
        <Group>
          <TextRow value={name} onChange={setName} placeholder="List Name" autoFocus={!list} />
        </Group>
        <Group>
          <Row label="Color">
            <Host matchContents style={styles.colorHost}>
              <ColorPicker selection={color} supportsOpacity={false} onSelectionChange={(c) => setColor(c.slice(0, 7))} />
            </Host>
          </Row>
        </Group>
        <Group>
          <View style={styles.icons}>
            {LIST_ICON_NAMES.map((n) => (
              <Pressable key={n} accessibilityLabel={n} onPress={() => setIcon(n)} style={[styles.iconButton, { backgroundColor: icon === n ? colors.fill : colors.fill4, borderColor: icon === n ? color : "transparent" }]}>
                <Icon name={listSymbol(n) as never} size={19} />
              </Pressable>
            ))}
          </View>
        </Group>
        {list && list.id !== "tasks" ? <DestructiveButton onPress={() => void deleteList(list.id).then(() => router.back())}>Delete List</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 24, paddingTop: 8, paddingBottom: 40 },
  center: { alignItems: "center" },
  colorHost: { width: 44, height: 32 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, paddingVertical: 16, justifyContent: "center" },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
