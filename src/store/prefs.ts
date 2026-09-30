import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PersonFilter = "me" | "other" | "both";
/** How many days the timeline shows side by side (Apple's Single Day / Multi Day). */
export type TimelineDays = 1 | 2;
/** Whose columns the timeline shows. */
export type TimelinePeople = "both" | "me" | "other";
/** The day screen as a timeline, or as Apple's List. */
export type DayDisplay = "timeline" | "list";
export type MonthDisplay = "stacked" | "list";
export type AppearancePref = "dark" | "light" | "system";

interface PrefsState {
  filter: PersonFilter;
  timelineDays: TimelineDays;
  timelinePeople: TimelinePeople;
  dayDisplay: DayDisplay;
  /** Points per hour at the default Text Size (the pinch zoom); the timeline scales it with Text Size, as Apple does. */
  hourHeight: number;
  monthDisplay: MonthDisplay;
  appearance: AppearancePref;
  /** Imported calendars hidden on this phone ("accountId:calendarId"), as Apple's Calendars sheet unticks them. */
  hiddenCalendars: string[];
  /** Routines (sleep, work) shaded in the day view, and in the iPad's week view (Settings → Timeline). */
  routinesInDay: boolean;
  routinesInWeek: boolean;
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
}

/**
 * The appearance the person chose (Dark by default) is applied to the whole app, native parts included (sheets,
 * keyboards, the status bar), through React Native's Appearance override.
 */
export function applyAppearance(pref: AppearancePref): void {
  Appearance.setColorScheme(pref === "system" ? "unspecified" : pref);
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
      appearance: "dark",
      hiddenCalendars: [],
      routinesInDay: true,
      routinesInWeek: true,
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
    }),
    {
      name: "gooya-prefs",
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      // Stored before the routine switches existed: they start on (the defaults above).
      partialize: (s) => ({ filter: s.filter, timelineDays: s.timelineDays, timelinePeople: s.timelinePeople, dayDisplay: s.dayDisplay, hourHeight: s.hourHeight, monthDisplay: s.monthDisplay, appearance: s.appearance, hiddenCalendars: s.hiddenCalendars, routinesInDay: s.routinesInDay, routinesInWeek: s.routinesInWeek }),
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
        applyAppearance(state?.appearance ?? "dark");
        usePrefs.setState({ hydrated: true });
      },
    },
  ),
);

// Before the stored preference is read, the app is dark (its default), so nothing flashes light.
applyAppearance("dark");
