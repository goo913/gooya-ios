import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import * as Haptics from "expo-haptics";
import { useNewItem } from "@/lib/actions";
import { useMe } from "@/lib/people";
import { useSheets } from "@/store/sheets";
import { usePrefs } from "@/store/prefs";
import { MonthView } from "@/views/MonthView";
import { useNav } from "@/store/nav";
import { useIsPad } from "@/lib/layout";
import { PadCalendar } from "@/pad/PadCalendar";
import { MacCalendar } from "@/mac/MacCalendar";
import { isMac } from "../../modules/gooya-mac";
import { useColors } from "@/theme";

/** The app's home: the iPhone's month screen, the iPad's calendar (src/pad) in a wide window, or the Mac's (src/mac). */
export default function Home() {
  const pad = useIsPad();
  if (isMac) return <MacCalendar />;
  return pad ? <PadCalendar /> : <MonthScreen />;
}

/** The month screen, the phone's home: the scrolling months with the floating pills over them. */
function MonthScreen() {
  const colors = useColors();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const monthKey: DateKey = month && /^\d{4}-\d{2}-01$/.test(month) ? month : `${todayKey(deviceTimeZone()).slice(0, 7)}-01`;
  const visible = useNav((s) => s.visibleMonthKey);
  const onPickDay = useCallback((key: DateKey) => router.push({ pathname: "/day/[date]", params: { date: key } }), []);
  const me = useMe();
  const openEditor = useSheets((s) => s.openEditor);
  const onHoldDay = useCallback(
    (key: DateKey) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      openEditor({ kind: "task", initialOwner: me, initialDate: key });
      router.push("/sheet/edit");
    },
    [me, openEditor],
  );
  const newItem = useNewItem();
  const monthDisplay = usePrefs((s) => s.monthDisplay);
  const setMonthDisplay = usePrefs((s) => s.setMonthDisplay);
  // Apple's month menu: the grid ("Details") or the List, plus GOOYA's task lists.
  const viewMenu = {
    icon: (monthDisplay === "list" ? "list.bullet.below.rectangle" : "rectangle.grid.1x2") as "rectangle.grid.1x2",
    groups: [
      {
        selection: monthDisplay,
        choices: [
          { value: "stacked", label: "Details", icon: "rectangle.grid.1x2" as const },
          { value: "list", label: "List", icon: "list.bullet.below.rectangle" as const },
        ],
        onSelect: (v: string) => setMonthDisplay(v === "list" ? "list" : "stacked"),
      },
    ],
    actions: [{ label: "Task Lists", icon: "checklist" as const, onPress: () => router.push("/lists") }],
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MonthView monthKey={monthKey} onPickDay={onPickDay} onHoldDay={onHoldDay} />
      <TopChrome back={visible.slice(0, 4)} onBack={() => router.push({ pathname: "/year", params: { year: visible.slice(0, 4) } })} viewMenu={viewMenu} onAdd={newItem} onSearch={() => router.push("/search")} />
      <BottomChrome onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
