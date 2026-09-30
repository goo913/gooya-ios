import type { DateKey } from "@shared/model";
import { router } from "expo-router";
import { useEffect } from "react";
import { usePad, type PadView } from "@/store/pad";

/** On an iPad a page of the phone (a day, a year) is a view of the one calendar screen: show it there and go back. */
export function PadRedirect({ view, date }: { view: PadView; date: DateKey }) {
  useEffect(() => {
    usePad.getState().show(view, date);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [view, date]);
  return null;
}
