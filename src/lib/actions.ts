import { router } from "expo-router";
import { useCallback } from "react";
import { useSheets } from "@/store/sheets";
import { useMe } from "./people";
import { useToday } from "./useNow";

/**
 * The "+" pill: a new task (the sheet offers Schedule and Routine too), dated today as Apple Calendar's + starts on today, so the
 * task shows on the calendar unless the date is switched off.
 */
export function useNewItem(): () => void {
  const me = useMe();
  const today = useToday();
  const openEditor = useSheets((s) => s.openEditor);
  return useCallback(() => {
    openEditor({ kind: "task", initialOwner: me, initialDate: today });
    router.push("/sheet/edit");
  }, [me, today, openEditor]);
}
