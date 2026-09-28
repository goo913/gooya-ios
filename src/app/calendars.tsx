import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { colorHex, peopleForFilter, useMe, usePerson } from "@/lib/people";
import { usePrefs, type PersonFilter } from "@/store/prefs";
import { useColors, useIsDark } from "@/theme";

type SegValue = "gooya" | "eunbi" | "both";

/** Which people's items show (the month, lists and search). */
export default function CalendarsSheet() {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const filter = usePrefs((s) => s.filter);
  const setFilter = usePrefs((s) => s.setFilter);
  const gooya = usePerson("gooya");
  const eunbi = usePerson("eunbi");
  const included = peopleForFilter(me, filter);
  const segValue: SegValue = filter === "both" ? "both" : included[0];
  const fromSeg = (v: SegValue): PersonFilter => (v === "both" ? "both" : v === me ? "me" : "other");
  const toggle = (key: PersonKey) => {
    const on = included.includes(key);
    if (on && included.length === 1) return;
    const next = on ? included.filter((k) => k !== key) : [...included, key];
    setFilter(next.length === 2 ? "both" : next[0] === me ? "me" : "other");
  };
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Calendars" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      <View style={styles.body}>
        <Segmented<SegValue>
          options={[
            { value: "gooya", label: gooya.name },
            { value: "eunbi", label: eunbi.name },
            { value: "both", label: "둘 다" },
          ]}
          value={segValue}
          onChange={(v) => setFilter(fromSeg(v))}
        />
        <Text style={[styles.header, { color: colors.label2 }]}>SHOW</Text>
        <View style={[styles.card, { backgroundColor: colors.bg3 }]}>
          {PERSON_KEYS.map((key, i) => {
            const p = key === "gooya" ? gooya : eunbi;
            const on = included.includes(key);
            return (
              <Pressable key={key} onPress={() => toggle(key)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
                <View style={[styles.dot, { backgroundColor: colorHex(p.color, dark) }]} />
                <Text style={[styles.name, { color: colors.label }]}>
                  {p.name}
                  {key === me ? <Text style={{ color: colors.label2 }}> · me</Text> : null}
                </Text>
                {on ? <Icon name="checkmark" size={18} color={colors.blue} weight="semibold" /> : null}
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.foot, { color: colors.label2 }]}>Applies to the month, lists and search. Day views have their own switch. Remembered on this phone.</Text>
        <Pressable
          onPress={() => {
            router.back();
            setTimeout(() => router.push("/settings"), 350);
          }}
          style={[styles.settings, { backgroundColor: colors.bg3 }]}
        >
          <Text style={[styles.settingsText, { color: colors.blue }]}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  header: { marginTop: 20, fontSize: 13, letterSpacing: 0.3 },
  card: { marginTop: 8, borderRadius: 12, overflow: "hidden" },
  row: { height: 46, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { flex: 1, fontSize: 17 },
  foot: { marginTop: 12, paddingHorizontal: 4, fontSize: 13, lineHeight: 17 },
  settings: { marginTop: 20, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  settingsText: { fontSize: 17 },
});
