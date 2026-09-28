import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { create } from "zustand";

interface NavState {
  /** Bumps when "Today" is tapped so the visible screen can scroll. */
  todayNonce: number;
  /** Month shown under the month screen's title (drives the back pill's year). */
  visibleMonthKey: DateKey;
  setVisibleMonth: (k: DateKey) => void;
  goToday: () => void;
}

const today = todayKey(deviceTimeZone());

export const useNav = create<NavState>((set, get) => ({
  todayNonce: 0,
  visibleMonthKey: `${today.slice(0, 7)}-01`,
  setVisibleMonth: (k) => {
    if (get().visibleMonthKey !== k) set({ visibleMonthKey: k });
  },
  goToday: () => set({ todayNonce: get().todayNonce + 1 }),
}));
