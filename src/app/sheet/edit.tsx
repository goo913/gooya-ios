import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Segmented } from "@/components/Segmented";
import { ScheduleEditor } from "@/sheets/ScheduleEditor";
import { TaskEditor } from "@/sheets/TaskEditor";
import { useSheets } from "@/store/sheets";

/** The New / Edit sheet requested through the sheets store (a page sheet). */
export default function EditSheet() {
  const req = useSheets((s) => s.editor);
  const close = useSheets((s) => s.closeEditor);
  const [kind, setKind] = useState<"task" | "schedule">(req?.kind ?? "task");
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  if (!req) return <View />;
  const onClose = () => {
    router.back();
    setTimeout(close, 400);
  };
  const isNew = !req.task && !req.schedule;
  const topBar = isNew ? (
    <View style={{ paddingHorizontal: 16 }}>
      <Segmented<"task" | "schedule">
        options={[
          { value: "task", label: "Task" },
          { value: "schedule", label: "Schedule" },
        ]}
        value={kind}
        onChange={setKind}
      />
    </View>
  ) : null;
  if (kind === "schedule") {
    return <ScheduleEditor schedule={req.schedule} dayOnly={req.dayOnly} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} topBar={topBar} onClose={onClose} />;
  }
  return <TaskEditor task={req.task} occ={req.occ} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} initialListId={req.initialListId} topBar={topBar} onClose={onClose} />;
}
