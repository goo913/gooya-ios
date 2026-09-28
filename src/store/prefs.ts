import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PersonFilter = "me" | "other" | "both";
export type TimelineMode = "two-days" | "one-day" | "me" | "other";
export type MonthDisplay = "stacked" | "list";
export type AppearancePref = "dark" | "light" | "system";

interface PrefsState {
  filter: PersonFilter;
  timelineMode: TimelineMode;
  hourHeight: number;
  monthDisplay: MonthDisplay;
  appearance: AppearancePref;
  hydrated: boolean;
  setFilter: (f: PersonFilter) => void;
  setAppearance: (a: AppearancePref) => void;
  setMonthDisplay: (m: MonthDisplay) => void;
  setTimelineMode: (m: TimelineMode) => void;
  setHourHeight: (h: number) => void;
}

/**
 * The appearance the person chose (Dark by default) is applied to the whole app, native parts included (sheets,
 * keyboards, the status bar), through React Native's Appearance override.
 */
export function applyAppearance(pref: AppearancePref): void {
  Appearance.setColorScheme(pref === "system" ? "unspecified" : pref);
}

/** Per-device preferences (remembered on the phone). */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      filter: "me",
      timelineMode: "two-days",
      hourHeight: 62,
      monthDisplay: "stacked",
      appearance: "dark",
      hydrated: false,
      setFilter: (filter) => set({ filter }),
      setAppearance: (appearance) => {
        set({ appearance });
        applyAppearance(appearance);
      },
      setMonthDisplay: (monthDisplay) => set({ monthDisplay }),
      setTimelineMode: (timelineMode) => set({ timelineMode }),
      setHourHeight: (hourHeight) => set({ hourHeight: Math.min(200, Math.max(28, hourHeight)) }),
    }),
    {
      name: "gooya-prefs",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ filter: s.filter, timelineMode: s.timelineMode, hourHeight: s.hourHeight, monthDisplay: s.monthDisplay, appearance: s.appearance }),
      onRehydrateStorage: () => (state) => {
        applyAppearance(state?.appearance ?? "dark");
        usePrefs.setState({ hydrated: true });
      },
    },
  ),
);

// Before the stored preference is read, the app is dark (its default), so nothing flashes light.
applyAppearance("dark");
