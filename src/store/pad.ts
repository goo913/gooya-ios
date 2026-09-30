import type { DateKey } from "@shared/model";
import { deviceTimeZone, todayKey } from "@shared/time";
import { create } from "zustand";
import type { DetailRequest } from "./sheets";

export type PadView = "day" | "week" | "month" | "year";

interface PadState {
  view: PadView;
  /** The day the views are about: the Day view's day, the Week view's week, the month and year scrolled to. */
  date: DateKey;
  /** Bumps when the month or year should scroll to `date` again (Today, a month picked in the year). */
  jump: number;
  /** What the Day view's details pane shows, and the occurrence drawn as selected. */
  selected: DetailRequest | null;
  selectedKey: string | null;
  setView: (view: PadView) => void;
  setDate: (date: DateKey) => void;
  show: (view: PadView, date: DateKey) => void;
  select: (req: DetailRequest | null, key?: string | null) => void;
  goToday: () => void;
}

/** The iPad's calendar: which view shows which day, and the item open beside the day (src/pad). */
export const usePad = create<PadState>((set, get) => ({
  view: "month",
  date: todayKey(deviceTimeZone()),
  jump: 0,
  selected: null,
  selectedKey: null,
  setView: (view) => set({ view, jump: get().jump + 1 }),
  setDate: (date) => set({ date }),
  show: (view, date) => set({ view, date, jump: get().jump + 1 }),
  select: (selected, key = null) => set({ selected, selectedKey: selected ? key : null }),
  goToday: () => set({ date: todayKey(deviceTimeZone()), jump: get().jump + 1 }),
}));
