import { useEffect, useState } from "react";
import { useIsDark } from "@/theme";
import { onWindowActive, windowActive } from "../../modules/gooya-mac";

/**
 * Apple Calendar's colours on the Mac (macOS 27), measured on its windows at 1× (light) and taken from the system's
 * own colours for dark (the same roles: the text background, a quaternary fill on weekends, separators, labels).
 */
export interface MacColors {
  /** The calendar's background. */
  bg: string;
  /** Saturday and Sunday (their columns in the month and the week). */
  weekend: string;
  /** The month's lines between days and weeks, and the week's between days. */
  line: string;
  /** Under the weekday names. */
  headerLine: string;
  /** The week's and day's hour lines, inside the working day and outside it (fainter). */
  hourLine: string;
  hourLineOff: string;
  /** Under the all-day row (three points). */
  allDayLine: string;
  text: string;
  /** Weekend days' numbers and names. */
  text2: string;
  /** The days of the months before and after the one shown. */
  faded: string;
  red: string;
  /** A selected task, and a new one's placeholder. */
  accent: string;
  /** Today's circle while the window is in the background. */
  inactive: string;
  /** The Day view's right pane, and the popover's fields. */
  pane: string;
  field: string;
  /** The week's and day's hours ("10 AM": the number, then the smaller AM). */
  hourText: string;
  hourSuffix: string;
}

const light: MacColors = {
  bg: "#ffffff",
  weekend: "#f9f9f9",
  line: "#e2e2e2",
  headerLine: "#c0c0c5",
  hourLine: "#e5e5e5",
  hourLineOff: "#f5f5f5",
  allDayLine: "#d9d9d9",
  text: "#262626",
  text2: "#808080",
  faded: "#b8b8b8",
  red: "#ff383c",
  accent: "#0a84ff",
  inactive: "#b0b0b0",
  pane: "#f2f2f2",
  field: "#e6e6e6",
  hourText: "#595959",
  hourSuffix: "#aeaeb2",
};

const dark: MacColors = {
  bg: "#1e1e1e",
  weekend: "#232323",
  line: "#363636",
  headerLine: "#4a4a4c",
  hourLine: "#333333",
  hourLineOff: "#272727",
  allDayLine: "#3c3c3c",
  text: "#dcdcdc",
  text2: "#8c8c8c",
  faded: "#5c5c5c",
  red: "#ff4245",
  accent: "#0a84ff",
  inactive: "#5f5f5f",
  pane: "#262626",
  field: "#333333",
  hourText: "#9a9a9a",
  hourSuffix: "#66666a",
};

export function useMacColors(): MacColors {
  return useIsDark() ? dark : light;
}

/** Whether GOOYA's window is in front (Apple greys today's circle and what is chosen while it is not). */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(windowActive);
  useEffect(() => {
    const sub = onWindowActive(setActive);
    return () => sub?.remove();
  }, []);
  return active;
}

/** Apple's month and week fonts at the default zoom; View → Zoom In and Out scale what is on the calendar only. */
export const ITEM_FONT = 12;
export const ZOOMS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
