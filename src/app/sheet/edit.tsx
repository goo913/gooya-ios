import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Segmented } from "@/components/Segmented";
import { EventEditor, useTwoWayCalendars } from "@/sheets/EventEditor";
import { ScheduleEditor } from "@/sheets/ScheduleEditor";
import { TaskEditor } from "@/sheets/TaskEditor";
import { useSheets } from "@/store/sheets";

type Kind = "task" | "event" | "schedule";

/** The New / Edit sheet requested through the sheets store (a page sheet). */
export default function EditSheet() {
  const req = useSheets((s) => s.editor);
  const close = useSheets((s) => s.closeEditor);
  const [kind, setKind] = useState<Kind>(req?.kind ?? "task");
  // Events can be made only in a two-way Google or iCloud calendar.
  const canEvent = useTwoWayCalendars().length > 0;
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  if (!req) return <View />;
  const onClose = () => {
    router.back();
    setTimeout(close, 400);
  };
  const isNew = !req.task && !req.schedule && !req.event;
  const topBar = isNew ? (
    <View style={{ paddingHorizontal: 16 }}>
      <Segmented<Kind>
        options={[
          { value: "task", label: "Task" },
          ...(canEvent || kind === "event" ? [{ value: "event" as const, label: "Event" }] : []),
          { value: "schedule", label: "Schedule" },
        ]}
        value={kind}
        onChange={setKind}
      />
    </View>
  ) : null;
  if (kind === "event") {
    return <EventEditor event={req.event} occ={req.eventOcc} initialDate={req.initialDate} initialMinutes={req.initialMinutes} topBar={topBar} onClose={onClose} />;
  }
  if (kind === "schedule") {
    return <ScheduleEditor schedule={req.schedule} dayOnly={req.dayOnly} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} topBar={topBar} onClose={onClose} />;
  }
  return <TaskEditor task={req.task} occ={req.occ} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} initialListId={req.initialListId} topBar={topBar} onClose={onClose} />;
}
