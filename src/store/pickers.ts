import { create } from "zustand";

/** What the category picker is asked: the chosen category (null for none), whether none may be chosen, and the answer. */
export interface CategoryRequest {
  value: string | null;
  onPick: (id: string | null) => void;
  /** Schedules may have no category ("None"); tasks always have one. */
  allowNone?: boolean;
}

/** Requests for the picker sheets (category, tags), handed over by the editor that opens them. */
interface PickersState {
  list: CategoryRequest | null;
  tags: { value: string[]; onChange: (tags: string[]) => void } | null;
  setList: (r: PickersState["list"]) => void;
  setTags: (r: PickersState["tags"]) => void;
}

export const usePickers = create<PickersState>((set) => ({
  list: null,
  tags: null,
  setList: (list) => set({ list }),
  setTags: (tags) => set({ tags }),
}));
