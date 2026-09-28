import { router } from "expo-router";
import { useCallback } from "react";
import { useSheets } from "@/store/sheets";
import { useMe } from "./people";

/** The "+" pill: a new task (the sheet offers Schedule too). */
export function useNewItem(): () => void {
  const me = useMe();
  const openEditor = useSheets((s) => s.openEditor);
  return useCallback(() => {
    openEditor({ kind: "task", initialOwner: me });
    router.push("/sheet/edit");
  }, [me, openEditor]);
}
