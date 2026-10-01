import type { SFSymbol } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCapsule } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { usePad, type PadView } from "@/store/pad";
import { useColors } from "@/theme";
import { isMac } from "../../modules/gooya-mac";

// The iPad's bar, measured on Apple Calendar for iPad (iPadOS 27, 820 points wide): glass capsules 44 points high,
// 8 points under the status bar: Calendars · Lists · Settings at the left with + beside them, Day · Week · Month ·
// Year in the middle, Search at the right. Under it the title ("September 2026", 34 points) and Today in red.
//
// On the Mac (Apple Calendar on macOS 27) the bar is the window's own toolbar, 52 points, drawn by macOS
// (modules/gooya-mac, GooyaMacToolbar); under it the title (30 points) with ‹ Today › at the right.

const VIEWS: { value: PadView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export const TOOLBAR_HEIGHT = 44;
/** The Mac window's toolbar (in its title bar, drawn by macOS), which the calendar starts under. */
export const MAC_TOOLBAR = 52;
const MAC_TITLE = 54;
/** From the top of the safe area to the bottom of the title row. */
export const PAD_HEADER = isMac ? MAC_TOOLBAR + MAC_TITLE : 8 + TOOLBAR_HEIGHT + 60;

function BarIcon({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => void Haptics.selectionAsync()} style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
      <Icon name={icon} size={23} color={colors.label} />
    </Pressable>
  );
}

export function PadToolbar({ width, onCalendars, onLists, onSettings, onAdd, onSearch }: { width: number; onCalendars: () => void; onLists: () => void; onSettings: () => void; onAdd: () => void; onSearch: () => void }) {
  // The Mac's is the window's toolbar (modules/gooya-mac).
  if (isMac) return null;
  return <TabletToolbar width={width} onCalendars={onCalendars} onLists={onLists} onSettings={onSettings} onAdd={onAdd} onSearch={onSearch} />;
}

function TabletToolbar({ width, onCalendars, onLists, onSettings, onAdd, onSearch }: { width: number; onCalendars: () => void; onLists: () => void; onSettings: () => void; onAdd: () => void; onSearch: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const view = usePad((s) => s.view);
  const setView = usePad((s) => s.setView);
  // Apple's widths at 820 points; a narrower window keeps the switcher centred between + and a search button.
  const roomy = width >= 800;
  const searchW = roomy ? 207 : TOOLBAR_HEIGHT;
  const segW = Math.min(288, width - 2 * Math.max(244, searchW + 22));
  return (
    <View style={[styles.bar, { top: insets.top + 8 }]}>
      <GlassCapsule style={styles.group}>
        <BarIcon icon="calendar" label="Calendars" onPress={onCalendars} />
        <BarIcon icon="checklist" label="Task Lists" onPress={onLists} />
        <BarIcon icon="gearshape" label="Settings" onPress={onSettings} />
      </GlassCapsule>
      <Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={onAdd} onPressIn={() => void Haptics.selectionAsync()} style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
        <GlassCapsule style={styles.round}>
          <Icon name="plus" size={24} color={colors.label} />
        </GlassCapsule>
      </Pressable>
      <View style={[styles.segments, { left: (width - segW) / 2, width: segW }]}>
        <GlassCapsule style={styles.segmentsInner}>
          {VIEWS.map((v) => {
            const on = v.value === view;
            return (
              <Pressable
                key={v.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v.label}
                onPress={() => setView(v.value)}
                onPressIn={() => void Haptics.selectionAsync()}
                style={[styles.segment, on && { backgroundColor: colors.bg }]}
              >
                <Text allowFontScaling={false} style={[styles.segmentText, { color: colors.label, fontWeight: on ? "600" : "400" }]}>
                  {v.label}
                </Text>
              </Pressable>
            );
          })}
        </GlassCapsule>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={onSearch} style={({ pressed }) => [styles.searchWrap, { width: searchW }, pressed && styles.pressed]}>
        <GlassCapsule style={[styles.search, !roomy && styles.searchRound]}>
          <Icon name="magnifyingglass" size={21} color={colors.label2} />
          {roomy ? (
            <Text allowFontScaling={false} style={[styles.searchText, { color: colors.label2 }]}>
              Search
            </Text>
          ) : null}
        </GlassCapsule>
      </Pressable>
    </View>
  );
}

/**
 * "September 2026" (the month bold, the year not), or the year alone in red; Today at the right (on the Mac ‹ Today ›,
 * and the title starts after the sidebar).
 */
export function PadTitle({ month, year, onToday, onStep, left = 0 }: { month: string | null; year: number; onToday: () => void; onStep?: (dir: 1 | -1) => void; left?: number }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (isMac) {
    return (
      <View style={[styles.macTitleRow, { left: left + 22 }]}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.macTitle, { color: month ? colors.label : colors.red }]}>
          {month ? (
            <>
              {month}
              <Text style={styles.titleYear}> {year}</Text>
            </>
          ) : (
            year
          )}
        </Text>
        <View style={styles.macNav}>
          <MacNavButton icon="chevron.left" label="Previous" onPress={() => onStep?.(-1)} />
          <Pressable accessibilityRole="button" accessibilityLabel="Today" onPress={onToday} style={({ pressed }) => [pressed && styles.pressed]}>
            <View style={[styles.macToday, { backgroundColor: colors.fill3 }]}>
              <Text allowFontScaling={false} style={[styles.macTodayText, { color: colors.label }]}>
                Today
              </Text>
            </View>
          </Pressable>
          <MacNavButton icon="chevron.right" label="Next" onPress={() => onStep?.(1)} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.titleRow, { top: insets.top + 8 + TOOLBAR_HEIGHT }]}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: month ? colors.label : colors.red }]}>
        {month ? (
          <>
            {month}
            <Text style={styles.titleYear}> {year}</Text>
          </>
        ) : (
          year
        )}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Today" onPress={onToday} hitSlop={10}>
        <Text allowFontScaling={false} style={[styles.today, { color: colors.red }]}>
          Today
        </Text>
      </Pressable>
    </View>
  );
}

function MacNavButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <View style={[styles.macNavButton, { backgroundColor: colors.fill3 }]}>
        <Icon name={icon} size={11} weight="semibold" color={colors.label} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 10, right: 10, height: TOOLBAR_HEIGHT, flexDirection: "row", alignItems: "center", zIndex: 10 },
  group: { height: TOOLBAR_HEIGHT, width: 166, flexDirection: "row", alignItems: "stretch" },
  icon: { flex: 1, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  add: { marginLeft: 12 },
  round: { width: TOOLBAR_HEIGHT, height: TOOLBAR_HEIGHT, alignItems: "center", justifyContent: "center" },
  segments: { position: "absolute", top: 0, height: TOOLBAR_HEIGHT, marginLeft: -10 },
  segmentsInner: { flex: 1, flexDirection: "row", padding: 4, gap: 2 },
  segment: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 17 },
  searchWrap: { position: "absolute", right: 0, height: TOOLBAR_HEIGHT },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  searchRound: { justifyContent: "center", paddingHorizontal: 0 },
  searchText: { fontSize: 17 },
  titleRow: { position: "absolute", left: 21, right: 17, height: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 5 },
  title: { fontSize: 34, fontWeight: "700", flexShrink: 1 },
  titleYear: { fontWeight: "400" },
  today: { fontSize: 17 },
  macTitleRow: { position: "absolute", top: MAC_TOOLBAR, right: 16, height: MAC_TITLE, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 5 },
  macTitle: { fontSize: 30, fontWeight: "700", flexShrink: 1 },
  macNav: { flexDirection: "row", alignItems: "center", gap: 6 },
  macNavButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  macToday: { height: 24, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  macTodayText: { fontSize: 13 },
});
