import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { useNewItem } from "@/lib/actions";
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
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MonthView monthKey={monthKey} onPickDay={onPickDay} />
      <TopChrome back={visible.slice(0, 4)} onBack={() => router.push({ pathname: "/year", params: { year: visible.slice(0, 4) } })} onAdd={newItem} onSearch={() => router.push("/search")} />
      <BottomChrome onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
