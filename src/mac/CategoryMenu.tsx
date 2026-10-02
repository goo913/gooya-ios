import { categoriesOf } from "@shared/categories";
import { StyleSheet, View } from "react-native";
import { useData } from "@/store/data";
import { MacPopup } from "./MacPopup";

/** A category picked from macOS's pop-up menu, its colour's dot beside it (Calendar's popover picks a list so). */
export function CategoryMenu({ value, name, color, onPick, allowNone = false }: { value: string | null; name: string; color: string | null; onPick: (id: string | null) => void; allowNone?: boolean }) {
  const lists = useData((s) => s.lists);
  const categories = categoriesOf(lists);
  const options = [...(allowNone ? ["None"] : []), ...categories.map((c) => c.name)];
  return (
    <View style={styles.row}>
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <MacPopup value={value ? name : allowNone ? "None" : name} options={options} onPick={(_, i) => onPick(allowNone ? (i === 0 ? null : categories[i - 1].id) : categories[i].id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
});
