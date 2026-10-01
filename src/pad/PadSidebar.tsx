import { PERSON_KEYS, type PersonKey } from "@shared/people";
import type { SFSymbol } from "expo-symbols";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import { colorHex, peopleForFilter, useMe, usePerson } from "@/lib/people";
import { useData } from "@/store/data";
import { usePrefs } from "@/store/prefs";
import { useColors, useIsDark } from "@/theme";
import { RULE } from "@/lib/layout";

/** How wide the Mac's sidebar is. */
export const SIDEBAR_WIDTH = 220;

/**
 * The Mac's sidebar, after Apple Calendar's calendar list: whose items show, GOOYA's schedules and each Google or
 * iCloud calendar with a tick in its colour (the same choices as the Calendars sheet on the iPhone and iPad), then
 * Task Lists, Categories and the calendar accounts.
 */
export function PadSidebar({ top }: { top: number }) {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
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
    <View style={[styles.bar, { width: SIDEBAR_WIDTH, paddingTop: top, backgroundColor: colors.bg2, borderRightColor: colors.separator }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Heading>People</Heading>
        {PERSON_KEYS.map((key) => {
          const p = key === "gooya" ? gooya : eunbi;
          return <Tick key={key} color={colorHex(p.color, dark)} checked={included.includes(key)} onPress={() => togglePerson(key)} title={key === me ? `${p.name} (Me)` : p.name} />;
        })}

        <Heading>GOOYA</Heading>
        <Tick color={colors.blue} checked={!hidden.includes("gooya:schedules")} onPress={() => toggleCalendar("gooya:schedules")} title="Schedules" />

        {imported.map(({ account, calendars }) => (
          <View key={account.id}>
            <Heading>{account.source === "google" ? "Google" : "iCloud"}</Heading>
            {calendars.map(([calId, c]) => (
              <Tick key={calId} color={c.color} checked={!hidden.includes(`${account.id}:${calId}`)} onPress={() => toggleCalendar(`${account.id}:${calId}`)} title={c.name} />
            ))}
          </View>
        ))}

        <View style={[styles.rule, { backgroundColor: colors.separator }]} />
        <Link icon="checklist" title="Task Lists" onPress={() => router.push("/lists")} />
        <Link icon="tag" title="Categories" onPress={() => router.push("/categories")} />
        <Link icon="calendar.badge.plus" title="Calendar Accounts" onPress={() => router.push("/integrations")} />
      </ScrollView>
    </View>
  );
}

function Heading({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text allowFontScaling={false} style={[styles.heading, { color: colors.label2 }]}>
      {children}
    </Text>
  );
}

/** A calendar's (or a person's) row: Apple's tick in its colour, then its name. */
function Tick({ color, checked, onPress, title }: { color: string; checked: boolean; onPress: () => void; title: string }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill4 }]}>
      <View style={[styles.box, { borderColor: color, backgroundColor: checked ? color : "transparent" }]}>
        {checked ? <Icon name="checkmark" size={9} weight="heavy" color="#ffffff" /> : null}
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: colors.label }]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Link({ icon, title, onPress }: { icon: SFSymbol; title: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill4 }]}>
      <View style={styles.linkIcon}>
        <Icon name={icon} size={14} color={colors.label2} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: colors.label }]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderRightWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: 10, paddingBottom: 24 },
  heading: { marginTop: 14, marginBottom: 4, paddingHorizontal: 8, fontSize: 11, fontWeight: "700" },
  row: { height: 26, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderRadius: 6 },
  box: { width: 14, height: 14, borderRadius: 3.5, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 13 },
  rule: { height: RULE, marginTop: 14, marginBottom: 8, marginHorizontal: 8 },
  linkIcon: { width: 14, alignItems: "center" },
});
