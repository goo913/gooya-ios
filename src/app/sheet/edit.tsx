import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Segmented } from "@/components/Segmented";
import { wantEscape, wantReturn } from "@/lib/dragCancel";
import { RoutineEditor } from "@/sheets/RoutineEditor";
import { ScheduleEditor } from "@/sheets/ScheduleEditor";
import { TaskEditor, type EditorHost } from "@/sheets/TaskEditor";
import { useSheets } from "@/store/sheets";
import { onCommand } from "../../../modules/gooya-mac";

type Kind = "task" | "schedule" | "routine";

/** The New / Edit sheet requested through the sheets store (a page sheet): a task, a schedule or a routine. */
export default function EditSheet() {
  const req = useSheets((s) => s.editor);
  const close = useSheets((s) => s.closeEditor);
  const [kind, setKind] = useState<Kind>(req?.kind ?? "task");
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  const onClose = useCallback(() => {
    router.back();
    setTimeout(close, 400);
  }, [close]);
  // A keyboard's Escape and Return (an iPad's, or the Mac's) save the form and close it, as its ✓ does; Escape closes one
  // that cannot be saved (a new one with no title). A field being typed in keeps Return.
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const host: EditorHost = { variant: "sheet", register: (save) => (saveRef.current = save) };
  const open = !!req;
  useEffect(() => {
    if (!open) return;
    wantEscape("sheet", true);
    wantReturn("sheet", true);
    const sub = onCommand((id) => {
      if (id !== "escape" && id !== "return") return;
      const save = saveRef.current;
      void (save ? save() : Promise.resolve(false)).then((saved) => {
        if (!saved && id === "escape") onClose();
      });
    });
    return () => {
      sub?.remove();
      wantEscape("sheet", false);
      wantReturn("sheet", false);
    };
  }, [open, onClose]);
  if (!req) return <View />;
  const isNew = !req.task && !req.routine && !req.event;
  const topBar = isNew ? (
    <View style={{ paddingHorizontal: 16 }}>
      <Segmented<Kind>
        options={[
          { value: "task", label: "Task" },
          { value: "schedule", label: "Schedule" },
          { value: "routine", label: "Routine" },
        ]}
        value={kind}
        onChange={setKind}
      />
    </View>
  ) : null;
  if (kind === "schedule") {
    return <ScheduleEditor event={req.event} occ={req.eventOcc} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} initialCategoryId={req.initialListId} topBar={topBar} onClose={onClose} host={host} />;
  }
  if (kind === "routine") {
    return <RoutineEditor routine={req.routine} dayOnly={req.dayOnly} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} topBar={topBar} onClose={onClose} host={host} />;
  }
  return <TaskEditor task={req.task} occ={req.occ} initialOwner={req.initialOwner} initialDate={req.initialDate} initialMinutes={req.initialMinutes} initialListId={req.initialListId} topBar={topBar} onClose={onClose} host={host} />;
}
