import type { DateKey, EventOccurrence, RoutineOccurrence, TaskOccurrence } from "@shared/model";
import type { PersonKey } from "@shared/people";
import { create } from "zustand";
import type { DetailRequest, EditorRequest } from "@/store/sheets";

/** Where a popover points: a rectangle in the window's points. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A new schedule or task being made: the day and time it was asked for, and the title typed so far. */
export interface Draft {
  date: DateKey;
  /** Minutes since midnight. */
  minutes: number;
  title: string;
  /** Whose it will be (the column double-clicked in the Day view; otherwise this device's person). */
  owner: PersonKey | null;
}

/**
 * Apple Calendar's popover beside the calendar: a new schedule or task (its placeholder drawn where it goes), an item
 * to edit, or the details of one that cannot be changed here (a routine, a read-only event).
 */
export type MacPopover = { kind: "new"; anchor: Anchor } | { kind: "edit"; anchor: Anchor; editor: EditorRequest } | { kind: "detail"; anchor: Anchor; detail: DetailRequest };

interface MacState {
  /** The day last clicked (a month's or year's cell), as Calendar selects it. */
  day: DateKey | null;
  /** The item clicked (its occurrence key): drawn selected. */
  item: string | null;
  draft: Draft | null;
  popover: MacPopover | null;
  /** The Day view's chosen item: its form in the pane beside the day (as Apple's inspector shows it). */
  picked: TaskOccurrence | EventOccurrence | RoutineOccurrence | null;
  /** Saves the new item being filled in the Day view's pane (a click elsewhere in the day does it), then closes it. */
  commit: (() => Promise<void>) | null;
  selectDay: (day: DateKey | null) => void;
  selectItem: (key: string | null) => void;
  pick: (occ: TaskOccurrence | EventOccurrence | RoutineOccurrence | null) => void;
  /** A new item at a day and time; its popover points at `anchor` (none in the Day view, whose pane shows it). */
  newItem: (date: DateKey, minutes: number, anchor: Anchor | null, owner?: PersonKey | null) => void;
  setDraftTitle: (title: string) => void;
  open: (p: MacPopover) => void;
  /** The popover (and a new item's placeholder) gone. */
  close: () => void;
}

export const useMac = create<MacState>((set) => ({
  day: null,
  item: null,
  draft: null,
  popover: null,
  picked: null,
  commit: null,
  selectDay: (day) => set({ day, item: null }),
  selectItem: (item) => set({ item }),
  pick: (picked) => set({ picked, item: picked?.key ?? null, draft: null }),
  newItem: (date, minutes, anchor, owner = null) => set({ draft: { date, minutes, title: "", owner }, popover: anchor ? { kind: "new", anchor } : null, item: null, picked: null, day: date }),
  setDraftTitle: (title) => set((s) => (s.draft ? { draft: { ...s.draft, title } } : {})),
  open: (popover) => set({ popover, draft: null }),
  close: () => set({ popover: null, draft: null }),
}));

/** The occurrence key a new item's placeholder is drawn with. */
export const DRAFT_KEY = "mac:draft";
