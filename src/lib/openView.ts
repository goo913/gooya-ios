import { todayKey } from "@shared/time";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { useNav } from "@/store/nav";
import { usePad } from "@/store/pad";
import { usePrefs, type OpenView } from "@/store/prefs";
import { viewerTz } from "./useNow";

// What GOOYA shows when it is opened (Settings → Opens In, remembered on each device): today, in the Day view (the
// iPhone's default), the iPad's Week view, or the month (the iPad's default). It applies when GOOYA starts, when it
// comes back after AWAY_MS in the background, and from the widget away from its days (gooya://open, src/app/open.tsx).
// A link to a day (the widget's days) or a tapped alert opens what it points at instead.

/** Back in GOOYA after this long in the background, it opens afresh; sooner, it stays where it was. */
export const AWAY_MS = 15 * 60 * 1000;

/** The choices, in Settings' order (the iPhone has no Week view). */
export const OPEN_VIEWS: { value: OpenView; label: string; pad: boolean }[] = [
  { value: "day", label: "Day", pad: false },
  { value: "week", label: "Week", pad: true },
  { value: "month", label: "Month", pad: false },
];

/** The choice, or the device's default: the iPhone opens on today's day, the iPad on the month (as before). */
export function resolveOpenView(chosen: OpenView | null, pad: boolean): OpenView {
  if (!chosen) return pad ? "month" : "day";
  return !pad && chosen === "week" ? "day" : chosen;
}

/** This device's Opens In. */
export function openViewFor(pad: boolean): OpenView {
  return resolveOpenView(usePrefs.getState().openView, pad);
}

/** Today in the view GOOYA opens in, from wherever it is: the screens over the home closed. */
export function showOpenView(pad: boolean): void {
  const view = openViewFor(pad);
  const today = todayKey(viewerTz);
  router.dismissTo("/");
  if (pad) {
    usePad.getState().select(null);
    usePad.getState().show(view, today);
    return;
  }
  useNav.getState().goToday();
  if (view === "day") router.push({ pathname: "/day/[date]", params: { date: today } });
}

let externalAt = 0;

/** A link or a tapped alert brought GOOYA up: what it points at wins over Opens In. */
export function noteExternalOpen(): void {
  externalAt = Date.now();
}

const openedByLink = () => Date.now() - externalAt < 3000;

/** Left as they are when GOOYA comes back: a sheet being filled in, Settings and its pages, Search. */
const BUSY = /^\/(sheet\/|settings|categories|integrations|calendars|search|sign-in|open)/;

/**
 * Opens In at launch (once signed in, the preferences read) and after time away. `pathname` is the screen shown: at
 * launch, anything but the home means GOOYA was opened by a link.
 */
export function useOpenView(ready: boolean, pathname: string, pad: boolean): void {
  const now = useRef({ pathname, pad, launched: false });
  useLayoutEffect(() => {
    now.current.pathname = pathname;
    now.current.pad = pad;
  });
  useEffect(() => {
    if (!ready || now.current.launched) return;
    now.current.launched = true;
    if (pathname !== "/" || openedByLink() || Notifications.getLastNotificationResponse()) return;
    // The home is the iPhone's month (shown already) and the iPad's calendar.
    const view = openViewFor(pad);
    const today = todayKey(viewerTz);
    requestAnimationFrame(() => {
      if (pad) usePad.getState().show(view, today);
      else if (view === "day") router.push({ pathname: "/day/[date]", params: { date: today } });
    });
  }, [ready, pathname, pad]);
  useEffect(() => {
    let left: number | null = null;
    const url = Linking.addEventListener("url", noteExternalOpen);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        left = Date.now();
        return;
      }
      if (state !== "active" || left === null) return;
      const away = Date.now() - left;
      left = null;
      if (away < AWAY_MS) return;
      // A link that brought GOOYA back arrives about now: wait for it.
      setTimeout(() => {
        if (openedByLink() || BUSY.test(now.current.pathname)) return;
        showOpenView(now.current.pad);
      }, 700);
    });
    return () => {
      url.remove();
      sub.remove();
    };
  }, []);
}
