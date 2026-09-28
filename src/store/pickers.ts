import { create } from "zustand";

/** Requests for the picker sheets (list, tags), handed over by the editor that opens them. */
interface PickersState {
  list: { value: string; onPick: (id: string) => void } | null;
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
