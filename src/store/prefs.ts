import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isMac } from "../../modules/gooya-mac";
import { env } from "@/lib/env";

export type PersonFilter = "me" | "other" | "both";
/** How many days the timeline shows side by side (Apple's Single Day / Multi Day). */
export type TimelineDays = 1 | 2;
/** Whose columns the timeline shows. */
export type TimelinePeople = "both" | "me" | "other";
/** The day screen as a timeline, or as Apple's List. */
export type DayDisplay = "timeline" | "list";
export type MonthDisplay = "stacked" | "list";
export type AppearancePref = "dark" | "light" | "system";
/** The view GOOYA opens in (Settings → Opens In): today in the Day view, the iPad's Week view, or the month. */
export type OpenView = "day" | "week" | "month";

interface PrefsState {
  filter: PersonFilter;
  timelineDays: TimelineDays;
  timelinePeople: TimelinePeople;
  dayDisplay: DayDisplay;
  /** Points per hour at the default Text Size (the pinch zoom); the timeline scales it with Text Size, as Apple does. */
  hourHeight: number;
  monthDisplay: MonthDisplay;
  appearance: AppearancePref;
  /**
   * Calendars hidden on this device ("accountId:calendarId"), as Apple's Calendars sheet unticks them; also GOOYA's
   * schedules ("gooya:schedules") and, from the Mac's sidebar, a category's tasks ("category:<id>").
   */
  hiddenCalendars: string[];
  /** Routines (sleep, work) shaded in the day view, and in the iPad's week view (Settings → Timeline). */
  routinesInDay: boolean;
  routinesInWeek: boolean;
  /** null until chosen: the device's own default (src/lib/openView.ts). */
  openView: OpenView | null;
  /** The Mac's sidebar (people and calendars) beside the calendar. */
  sidebar: boolean;
  /** The Mac's menu bar shows GOOYA's icon with today's and tomorrow's items. */
  menuBarAgenda: boolean;
  /** GOOYA has been set to open at login once, as the Mac app first did (Settings turns it off). */
  loginItemSetUp: boolean;
  /** The Mac's View → Zoom In and Out: how big what is on the calendar is drawn (1 is Apple's size). */
  itemZoom: number;
  /** What the Mac's new-item popover makes first (it remembers the last choice, as Calendar does). */
  newKind: "task" | "schedule";
  hydrated: boolean;
  setFilter: (f: PersonFilter) => void;
  setAppearance: (a: AppearancePref) => void;
  setMonthDisplay: (m: MonthDisplay) => void;
  setTimelineDays: (d: TimelineDays) => void;
  setTimelinePeople: (p: TimelinePeople) => void;
  setDayDisplay: (d: DayDisplay) => void;
  setHourHeight: (h: number) => void;
  toggleCalendar: (id: string) => void;
  setRoutinesInDay: (on: boolean) => void;
  setRoutinesInWeek: (on: boolean) => void;
  setOpenView: (v: OpenView) => void;
  setSidebar: (on: boolean) => void;
  setMenuBarAgenda: (on: boolean) => void;
  setLoginItemSetUp: () => void;
  setItemZoom: (z: number) => void;
  setNewKind: (k: "task" | "schedule") => void;
}

/**
 * The appearance the person chose (Dark by default) is applied to the whole app, native parts included (sheets,
 * keyboards, the status bar), through React Native's Appearance override.
 */
export function applyAppearance(pref: AppearancePref): void {
  const shown = env.demoAppearance ?? pref;
  Appearance.setColorScheme(shown === "system" ? "unspecified" : shown);
}

/** Apple's hour at the default Text Size (50 points; 61.7 two steps up). */
export const DEFAULT_HOUR_HEIGHT = 50;

/** Per-device preferences (remembered on the phone). */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      filter: "me",
      timelineDays: 1,
      timelinePeople: "both",
      dayDisplay: "timeline",
      hourHeight: DEFAULT_HOUR_HEIGHT,
      monthDisplay: "stacked",
      // The phones are dark by default; the Mac follows its own appearance.
      appearance: isMac ? "system" : "dark",
      hiddenCalendars: [],
      routinesInDay: true,
      routinesInWeek: true,
      openView: null,
      sidebar: true,
      menuBarAgenda: true,
      loginItemSetUp: false,
      itemZoom: 1,
      newKind: "task",
      hydrated: false,
      setFilter: (filter) => set({ filter }),
      setAppearance: (appearance) => {
        set({ appearance });
        applyAppearance(appearance);
      },
      setMonthDisplay: (monthDisplay) => set({ monthDisplay }),
      setTimelineDays: (timelineDays) => set({ timelineDays }),
      setTimelinePeople: (timelinePeople) => set({ timelinePeople }),
      setDayDisplay: (dayDisplay) => set({ dayDisplay }),
      setHourHeight: (hourHeight) => set({ hourHeight: Math.min(190, Math.max(20, hourHeight)) }),
      toggleCalendar: (id) => set((s) => ({ hiddenCalendars: s.hiddenCalendars.includes(id) ? s.hiddenCalendars.filter((c) => c !== id) : [...s.hiddenCalendars, id] })),
      setRoutinesInDay: (routinesInDay) => set({ routinesInDay }),
      setRoutinesInWeek: (routinesInWeek) => set({ routinesInWeek }),
      setOpenView: (openView) => set({ openView }),
      setSidebar: (sidebar) => set({ sidebar }),
      setMenuBarAgenda: (menuBarAgenda) => set({ menuBarAgenda }),
      setLoginItemSetUp: () => set({ loginItemSetUp: true }),
      setItemZoom: (itemZoom) => set({ itemZoom: Math.min(2, Math.max(0.85, itemZoom)) }),
      setNewKind: (newKind) => set({ newKind }),
    }),
    {
      name: "gooya-prefs",
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      // Stored before the routine switches, Opens In and the Mac's choices existed: they start as the defaults above.
      partialize: (s) => ({
        filter: s.filter,
        timelineDays: s.timelineDays,
        timelinePeople: s.timelinePeople,
        dayDisplay: s.dayDisplay,
        hourHeight: s.hourHeight,
        monthDisplay: s.monthDisplay,
        appearance: s.appearance,
        hiddenCalendars: s.hiddenCalendars,
        routinesInDay: s.routinesInDay,
        routinesInWeek: s.routinesInWeek,
        openView: s.openView,
        sidebar: s.sidebar,
        menuBarAgenda: s.menuBarAgenda,
        loginItemSetUp: s.loginItemSetUp,
        itemZoom: s.itemZoom,
        newKind: s.newKind,
      }),
      // Version 1 kept one "timeline mode" and an hour height in points at any Text Size (62 by default). Version 3
      // made Single Day the default: the day opens as one day again, where Multi Day had been the default.
      migrate: (persisted, version) => {
        let old = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const mode = old.timelineMode;
          const hour = typeof old.hourHeight === "number" ? old.hourHeight : 62;
          old = {
            ...old,
            timelinePeople: mode === "me" ? "me" : mode === "other" ? "other" : "both",
            dayDisplay: "timeline",
            hourHeight: (hour / 62) * DEFAULT_HOUR_HEIGHT,
          };
        }
        if (version < 3) old = { ...old, timelineDays: 1 };
        return old;
      },
      onRehydrateStorage: () => (state) => {
        applyAppearance(state?.appearance ?? (isMac ? "system" : "dark"));
        usePrefs.setState({ hydrated: true });
      },
    },
  ),
);

// Before the stored preference is read, the app is dark (its default on the phones), so nothing flashes light.
applyAppearance(isMac ? "system" : "dark");
