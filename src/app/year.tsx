import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { useNewItem } from "@/lib/actions";
import { useNav } from "@/store/nav";
import { YearView } from "@/views/YearView";
import { useColors } from "@/theme";

export default function YearScreen() {
  const colors = useColors();
  const { year } = useLocalSearchParams<{ year?: string }>();
  const y = Number(year) || Number(todayKey(deviceTimeZone()).slice(0, 4));
  const onPickMonth = (monthKey: DateKey) => router.navigate({ pathname: "/", params: { month: monthKey } });
  const newItem = useNewItem();
  // As in Apple Calendar, Today on the year screen opens the current month.
  const openToday = () => {
    router.navigate({ pathname: "/", params: { month: `${todayKey(deviceTimeZone()).slice(0, 7)}-01` } });
    setTimeout(() => useNav.getState().goToday(), 350);
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <YearView year={y} onPickMonth={onPickMonth} />
      <TopChrome back={null} hideView onAdd={newItem} onSearch={() => router.push("/search")} />
      <BottomChrome onToday={openToday} onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
