import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCapsule } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { patchSettings } from "@/lib/db";
import { colorHex, peopleForFilter, useMe, usePerson } from "@/lib/people";
import { useData } from "@/store/data";
import { usePrefs } from "@/store/prefs";
import { useColors, useIsDark } from "@/theme";

/**
 * Apple Calendar's Calendars sheet: whose items show (the month, lists and search; the day view has its own menu),
 * each imported Google or iCloud calendar with its own tick, and completed tasks shown or not.
 */
export default function CalendarsSheet() {
  const colors = useColors();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const mine = usePerson(me);
  const filter = usePrefs((s) => s.filter);
  const setFilter = usePrefs((s) => s.setFilter);
  const hidden = usePrefs((s) => s.hiddenCalendars);
  const toggleCalendar = usePrefs((s) => s.toggleCalendar);
  const accounts = useData((s) => s.accounts);
  const gooya = usePerson("gooya");
  const eunbi = usePerson("eunbi");
  const included = peopleForFilter(me, filter);
  const togglePerson = (key: PersonKey) => {
    const on = included.includes(key);
    if (on && included.length === 1) return;
    const next = on ? included.filter((k) => k !== key) : [...included, key];
    setFilter(next.length === 2 ? "both" : next[0] === me ? "me" : "other");
  };
  const imported = accounts
    .map((a) => ({ account: a, calendars: Object.entries(a.calendars ?? {}).filter(([, c]) => c.direction === "import" || c.direction === "both") }))
    .filter((g) => g.calendars.length > 0);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} hitSlop={6}>
          <GlassCapsule style={styles.round}>
            <Icon name="xmark" size={19} weight="semibold" color={colors.label} />
          </GlassCapsule>
        </Pressable>
        <Text style={[styles.title, { color: colors.label }]}>Calendars</Text>
        <View style={styles.round} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        <SectionHeader>People</SectionHeader>
        <Card>
          {PERSON_KEYS.map((key, i) => {
            const p = key === "gooya" ? gooya : eunbi;
            return (
              <CheckRow key={key} first={i === 0} color={colorHex(p.color, dark)} checked={included.includes(key)} onPress={() => togglePerson(key)} title={p.name} subtitle={key === me ? "Me" : undefined} />
            );
          })}
        </Card>
        <Text style={[styles.foot, { color: colors.label2 }]}>The month, lists and search. The day view has its own choice in its view menu.</Text>

        {imported.map(({ account, calendars }) => (
          <View key={account.id}>
            <SectionHeader>{account.source === "google" ? "Google" : "iCloud"}</SectionHeader>
            <Card>
              {calendars.map(([calId, c], i) => (
                <CheckRow
                  key={calId}
                  first={i === 0}
                  color={c.color}
                  checked={!hidden.includes(`${account.id}:${calId}`)}
                  onPress={() => toggleCalendar(`${account.id}:${calId}`)}
                  title={c.name}
                  subtitle={account.email !== c.name ? account.email : undefined}
                />
              ))}
            </Card>
          </View>
        ))}

        <Card style={styles.gap}>
          <View style={styles.row}>
            <Text style={[styles.rowTitle, { color: colors.label, flex: 1 }]}>Show Completed Tasks</Text>
            <View style={styles.switchBox}>
              <Switch value={mine.settings.showCompleted !== false} onValueChange={(v) => void patchSettings(me, { showCompleted: v })} />
            </View>
          </View>
        </Card>

        <Card style={styles.gap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Calendar"
            onPress={() => {
              router.back();
              setTimeout(() => router.push("/integrations"), 350);
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill4 }]}
          >
            <Icon name="calendar.badge.plus" size={22} color={colors.label} />
            <Text style={[styles.rowTitle, { color: colors.label, flex: 1 }]}>Add Calendar</Text>
            <Icon name="chevron.right" size={14} weight="semibold" color={colors.label3} />
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.section, { color: colors.label2 }]}>{children}</Text>;
}

function Card({ children, style }: { children: ReactNode; style?: object }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.bg3 }, style]}>{children}</View>;
}

/** A row with Apple's round tick in the calendar's (or person's) colour. */
function CheckRow({ color, checked, onPress, title, subtitle, first }: { color: string; checked: boolean; onPress: () => void; title: string; subtitle?: string; first: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill4 }]}
    >
      <View style={[styles.check, checked ? { backgroundColor: color } : { borderWidth: 2, borderColor: colors.label3 }]}>{checked ? <Icon name="checkmark" size={13} weight="bold" color="#ffffff" /> : null}</View>
      <View style={[styles.rowText, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
        <Text style={[styles.rowTitle, { color: colors.label }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: colors.label2 }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 15, paddingBottom: 6 },
  round: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600" },
  section: { marginTop: 18, marginBottom: 8, paddingHorizontal: 32, fontSize: 17, fontWeight: "600" },
  card: { marginHorizontal: 16, borderRadius: 26, overflow: "hidden" },
  gap: { marginTop: 24 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 16, paddingRight: 18 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, alignSelf: "stretch", justifyContent: "center", paddingVertical: 14 },
  rowTitle: { fontSize: 17 },
  rowSub: { fontSize: 15, marginTop: 1 },
  switchBox: { height: 52, justifyContent: "center" },
  foot: { marginTop: 8, paddingHorizontal: 32, fontSize: 13, lineHeight: 17 },
});
