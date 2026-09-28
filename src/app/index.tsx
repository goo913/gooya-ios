import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { pickOption } from "@/components/Form";
import { useNewItem } from "@/lib/actions";
import { usePrefs } from "@/store/prefs";
import { MonthView } from "@/views/MonthView";
import { useNav } from "@/store/nav";
import { useColors } from "@/theme";

/** The month screen, the app's home: the scrolling months with the floating pills over them. */
export default function MonthScreen() {
  const colors = useColors();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const monthKey: DateKey = month && /^\d{4}-\d{2}-01$/.test(month) ? month : `${todayKey(deviceTimeZone()).slice(0, 7)}-01`;
  const visible = useNav((s) => s.visibleMonthKey);
  const onPickDay = useCallback((key: DateKey) => router.push({ pathname: "/day/[date]", params: { date: key } }), []);
  const newItem = useNewItem();
  const monthDisplay = usePrefs((s) => s.monthDisplay);
  const setMonthDisplay = usePrefs((s) => s.setMonthDisplay);
  const viewOptions = () =>
    pickOption(["Month", "List", "Task lists"], monthDisplay === "list" ? "List" : "Month", (_, i) => {
      if (i === 2) router.push("/lists");
      else setMonthDisplay(i === 1 ? "list" : "stacked");
    });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MonthView monthKey={monthKey} onPickDay={onPickDay} />
      <TopChrome back={visible.slice(0, 4)} onBack={() => router.push({ pathname: "/year", params: { year: visible.slice(0, 4) } })} onViewOptions={viewOptions} onAdd={newItem} onSearch={() => router.push("/search")} />
      <BottomChrome onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
