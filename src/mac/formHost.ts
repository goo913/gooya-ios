import { useEffect, useLayoutEffect, useRef } from "react";
import { wantEscape, wantReturn } from "@/lib/dragCancel";
import type { EditorHost } from "@/sheets/TaskEditor";
import { useMac } from "./state";

let hosts = 0;

/**
 * A form's place on the Mac while it is open (the popover, the Day view's pane): the form registers its save, and a
 * click elsewhere, Escape, Return or its Done button save it (`useMac`'s commit); without a save to make (no title, a
 * routine's details) `close` closes it.
 */
export function useMacFormHost(close: () => void, onTitle?: (title: string) => void): EditorHost {
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const reason = `form${++hosts}`;
    const commit = async () => {
      const save = saveRef.current;
      if (!save || !(await save())) closeRef.current();
    };
    useMac.setState({ commit });
    wantEscape(reason, true);
    wantReturn(reason, true);
    return () => {
      if (useMac.getState().commit === commit) useMac.setState({ commit: null });
      wantEscape(reason, false);
      wantReturn(reason, false);
    };
  }, []);
  return { variant: "mac", register: (save) => (saveRef.current = save), onTitle };
}
