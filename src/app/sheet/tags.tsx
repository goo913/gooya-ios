import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Group } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { withAlpha } from "@/lib/color";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors } from "@/theme";

const normalizeTag = (raw: string): string => raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();

/** Free-form #tags with autocomplete from tags already in use. */
export default function TagsSheet() {
  const colors = useColors();
  const tasks = useData((s) => s.tasks);
  const req = usePickers((s) => s.tags);
  const [value, setValue] = useState<string[]>(req?.value ?? []);
  const [input, setInput] = useState("");
  const all = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [tasks]);
  const needle = normalizeTag(input);
  const suggestions = all.filter((t) => !value.includes(t) && (!needle || t.startsWith(needle))).slice(0, 12);
  const change = (next: string[]) => {
    setValue(next);
    req?.onChange(next);
  };
  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t || value.includes(t)) return;
    change([...value, t]);
    setInput("");
  };
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Tags" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.chips}>
          {value.map((t) => (
            <Pressable key={t} onPress={() => change(value.filter((x) => x !== t))} style={[styles.chip, { backgroundColor: withAlpha(colors.blue, 0.15) }]}>
              <Text style={[styles.chipText, { color: colors.blue }]}>#{t}</Text>
              <Icon name="xmark" size={10} color={colors.blue} weight="bold" />
            </Pressable>
          ))}
          {value.length === 0 ? <Text style={[styles.none, { color: colors.label3 }]}>No tags yet</Text> : null}
        </View>
        <Group>
          <View style={styles.inputRow}>
            <Text style={[styles.hash, { color: colors.label2 }]}>#</Text>
            <TextInput value={input} onChangeText={setInput} placeholder="Add tag" placeholderTextColor={colors.label3} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => add(input)} blurOnSubmit={false} autoFocus style={[styles.input, { color: colors.label }]} />
          </View>
        </Group>
        {suggestions.length ? (
          <View style={styles.suggestWrap}>
            <Text style={[styles.suggestTitle, { color: colors.label2 }]}>{needle ? "MATCHING" : "EXISTING TAGS"}</Text>
            <View style={styles.chips}>
              {suggestions.map((t) => (
                <Pressable key={t} onPress={() => add(t)} style={[styles.chip, { backgroundColor: colors.fill3 }]}>
                  <Text style={[styles.chipText, { color: colors.label }]}>#{t}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 16, paddingBottom: 32 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16 },
  chip: { height: 30, borderRadius: 15, paddingLeft: 12, paddingRight: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  chipText: { fontSize: 15 },
  none: { fontSize: 15 },
  inputRow: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  hash: { fontSize: 17 },
  input: { flex: 1, fontSize: 17 },
  suggestWrap: { gap: 8 },
  suggestTitle: { paddingHorizontal: 16, fontSize: 13 },
});
