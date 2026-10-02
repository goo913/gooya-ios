import type { DateKey } from "@shared/model";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useIsPad } from "@/lib/layout";
import { noteExternalOpen, showOpenView } from "@/lib/openView";
import { usePad, type PadView } from "@/store/pad";

const VIEWS: PadView[] = ["day", "week", "month", "year"];

/**
 * gooya://open (the widget, away from its days): today in the view GOOYA opens in (Settings → Opens In). On an iPad or
 * the Mac, gooya://open?view=week&date=2026-10-07 shows that view of that day.
 */
export default function Open() {
  const pad = useIsPad();
  const { view, date } = useLocalSearchParams<{ view?: string; date?: string }>();
  useEffect(() => {
    noteExternalOpen();
    if (pad && view && VIEWS.includes(view as PadView)) {
      router.dismissTo("/");
      usePad.getState().select(null);
      usePad.getState().show(view as PadView, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? (date as DateKey) : usePad.getState().date);
      return;
    }
    showOpenView(pad);
  }, [pad, view, date]);
  return null;
}
