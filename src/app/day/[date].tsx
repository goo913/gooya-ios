import type { DateKey } from "@shared/model";
import { otherPerson } from "@shared/people";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import type { MenuGroup } from "@/components/NativeMenu";
import { MONTH_NAMES } from "@/lib/format";
import { useMetrics } from "@/lib/metrics";
import { useMe, usePerson } from "@/lib/people";
import { usePrefs, type TimelinePeople } from "@/store/prefs";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";
import { DayView, type DayActions } from "@/views/DayView";
import { ListView } from "@/views/ListView";

export default function DayScreen() {
  const colors = useColors();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = date as DateKey;
  const month = MONTH_NAMES[Number(dateKey.slice(5, 7)) - 1];
  const openDetail = useSheets((s) => s.openDetail);
  const openEditor = useSheets((s) => s.openEditor);
  const insets = useSafeAreaInsets();
  const m = useMetrics();
  const me = useMe();
  const mine = usePerson(me);
  const theirs = usePerson(otherPerson(me));
  const dayDisplay = usePrefs((s) => s.dayDisplay);
  const timelineDays = usePrefs((s) => s.timelineDays);
  const timelinePeople = usePrefs((s) => s.timelinePeople);
  const layout = dayDisplay === "list" ? "list" : timelineDays === 1 ? "one" : "two";
  // Apple's day menu (Single Day · Multi Day · List), and whose columns to show.
  const viewMenu = {
    icon: (layout === "list" ? "list.bullet" : layout === "one" ? "calendar.day.timeline.left" : "rectangle.split.2x1") as "list.bullet",
    groups: [
      {
        selection: layout,
        choices: [
          { value: "one", label: "Single Day", icon: "calendar.day.timeline.left" },
          { value: "two", label: "Multi Day", icon: "rectangle.split.2x1" },
          { value: "list", label: "List", icon: "list.bullet" },
        ],
        onSelect: (v: string) => {
          const p = usePrefs.getState();
          if (v === "list") p.setDayDisplay("list");
          else {
            p.setDayDisplay("timeline");
            p.setTimelineDays(v === "one" ? 1 : 2);
          }
        },
      },
      {
        selection: timelinePeople,
        choices: [
          { value: "both", label: "Both of Us", icon: "person.2" },
          { value: "me", label: mine.name, icon: "person" },
          { value: "other", label: theirs.name, icon: "person.fill" },
        ],
        onSelect: (v: string) => usePrefs.getState().setTimelinePeople(v as TimelinePeople),
      },
    ] as MenuGroup[],
  };
  const actions = useMemo<DayActions>(
    () => ({
      openTask: (occ) => {
        openDetail({ kind: "task", taskId: occ.task.id, dateKey: occ.dateKey });
        router.push("/sheet/detail");
      },
      openRoutine: (occ) => {
        openDetail({ kind: "routine", routineId: occ.routine.id, dateKey: occ.dateKey });
        router.push("/sheet/detail");
      },
      openEvent: (occ) => {
        openDetail({ kind: "event", eventId: occ.event.id, dateKey: occ.dateKey });
        router.push("/sheet/detail");
      },
      editTask: (occ) => {
        openEditor({ kind: "task", task: occ.task, occ });
        router.push("/sheet/edit");
      },
      editRoutine: (occ, dayOnly) => {
        openEditor({ kind: "routine", routine: occ.routine, dayOnly: dayOnly ? occ.dateKey : undefined });
        router.push("/sheet/edit");
      },
      createTask: (d, person, minutes) => {
        openEditor({ kind: "task", initialDate: d, initialOwner: person, initialMinutes: minutes });
        router.push("/sheet/edit");
      },
    }),
    [openDetail, openEditor],
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {dayDisplay === "list" ? (
        <ListView from={dateKey} topInset={insets.top + m.barHeight + 4} />
      ) : (
        <DayView dateKey={dateKey} onChangeDate={(k) => router.setParams({ date: k })} actions={actions} />
      )}
      <TopChrome back={month} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} viewMenu={viewMenu} onAdd={() => actions.createTask(dateKey, me, 9 * 60)} onSearch={() => router.push("/search")} />
      <BottomChrome onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
