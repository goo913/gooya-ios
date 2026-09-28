import type { DateKey } from "@shared/model";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { BottomChrome, TopChrome } from "@/components/Chrome";
import { MONTH_NAMES } from "@/lib/format";
import { useSheets } from "@/store/sheets";
import { useColors } from "@/theme";
import { DayView, type DayActions } from "@/views/DayView";

export default function DayScreen() {
  const colors = useColors();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = date as DateKey;
  const month = MONTH_NAMES[Number(dateKey.slice(5, 7)) - 1];
  const openDetail = useSheets((s) => s.openDetail);
  const openEditor = useSheets((s) => s.openEditor);
  const actions = useMemo<DayActions>(
    () => ({
      openTask: (occ) => {
        openDetail({ kind: "task", taskId: occ.task.id, dateKey: occ.dateKey });
        router.push("/sheet/detail");
      },
      openSchedule: (occ) => {
        openDetail({ kind: "schedule", scheduleId: occ.schedule.id, dateKey: occ.dateKey });
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
      editSchedule: (occ, dayOnly) => {
        openEditor({ kind: "schedule", schedule: occ.schedule, dayOnly: dayOnly ? occ.dateKey : undefined });
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
      <DayView dateKey={dateKey} onChangeDate={(k) => router.setParams({ date: k })} actions={actions} />
      <TopChrome back={month} onBack={() => router.back()} viewIcon="day" onAdd={() => actions.createTask(dateKey, "gooya", 9 * 60)} onSearch={() => router.push("/search")} />
      <BottomChrome onSettings={() => router.push("/settings")} onCalendars={() => router.push("/calendars")} />
    </View>
  );
}
