import { setEscape, setReturn } from "../../modules/gooya-mac";

/**
 * Escape on the Mac: while something can be cancelled with it (an item being dragged, a new item's popover), the key
 * is GOOYA's (modules/gooya-mac sends it as the "escape" command); otherwise it does what it always does.
 */
const wanting = new Set<string>();

export function wantEscape(reason: string, on: boolean): void {
  const had = wanting.size > 0;
  if (on) wanting.add(reason);
  else wanting.delete(reason);
  if (had !== wanting.size > 0) setEscape(wanting.size > 0);
}

const wantingReturn = new Set<string>();

/** Return on the Mac: while a form is open it saves it (a field being typed in keeps the key: a note's new line). */
export function wantReturn(reason: string, on: boolean): void {
  const had = wantingReturn.size > 0;
  if (on) wantingReturn.add(reason);
  else wantingReturn.delete(reason);
  if (had !== wantingReturn.size > 0) setReturn(wantingReturn.size > 0);
}

/** The drag in progress: how to put the item back where it was. */
let current: (() => void) | null = null;

/** A drag began; Escape calls `cancel` (which puts it back and leaves letting go doing nothing). */
export function beginDrag(cancel: () => void): void {
  current = cancel;
  wantEscape("drag", true);
}

/** The drag ended (dropped or cancelled). */
export function endDrag(cancel?: () => void): void {
  if (cancel && current !== cancel) return;
  current = null;
  wantEscape("drag", false);
}

/** Escape during a drag: true when there was one to cancel. */
export function cancelDrag(): boolean {
  const cancel = current;
  endDrag();
  if (!cancel) return false;
  cancel();
  return true;
}
