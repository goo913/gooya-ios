import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { diffDaysKey } from "@shared/time";
import * as Haptics from "expo-haptics";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { create } from "zustand";
import { beginDrag, endDrag } from "@/lib/dragCancel";
import { liftPan } from "@/lib/gestures";
import { canMove, moveEventByDays, moveTaskByDays } from "@/lib/moves";
import { useColors } from "@/theme";

// Dragging in a month (the iPhone's and the iPad's), as in Apple Calendar: touch and hold a task or a schedule, drag it
// to another day (the day under the finger lights up; near the top or bottom the months scroll), let go. It keeps its
// time; something on several days moves as a whole, by as many days as the finger moved.

type Item = TaskOccurrence | EventOccurrence;

interface DragState {
  item: Item | null;
  /** The day it was picked up on (the day under the finger), and the day under the finger now. */
  grab: DateKey | null;
  target: DateKey | null;
  /** The finger, in the window. */
  x: number;
  y: number;
  /** Where the finger held it, within it. */
  dx: number;
  dy: number;
}

export const useMonthDrag = create<DragState>(() => ({ item: null, grab: null, target: null, x: 0, y: 0, dx: 0, dy: 0 }));

/** What a month view tells the drag: its days' places in the window, and scrolling. */
export interface MonthDragHost {
  /** The day under a point of the window, or null (between months, outside the grid). */
  dayAt: (x: number, y: number) => DateKey | null;
  /** Where a day's cell is in the window (null when it is not laid out). */
  cellRect: (day: DateKey) => { x: number; y: number; w: number; h: number } | null;
  /** Scrolls by `dy` points; false when it is already at that end. */
  scrollBy: (dy: number) => boolean;
  /** The window's y range the months show in (they scroll when the finger is near its ends). */
  bounds: () => { top: number; bottom: number };
}

export const MonthDragContext = createContext<MonthDragHost | null>(null);

let host: MonthDragHost | null = null;
let frame: number | null = null;
const EDGE = 70;

function follow(x: number, y: number) {
  const s = useMonthDrag.getState();
  if (!s.item || !host) return;
  const target = host.dayAt(x, y) ?? s.target;
  if (target !== s.target) void Haptics.selectionAsync();
  useMonthDrag.setState({ x, y, target });
}

/** Near the top or bottom, the months scroll under the finger (faster the nearer the edge). */
function scrollLoop() {
  const s = useMonthDrag.getState();
  if (!s.item || !host) {
    frame = null;
    return;
  }
  const { top, bottom } = host.bounds();
  const speed = s.y < top + EDGE ? -Math.ceil((top + EDGE - s.y) / 5) : s.y > bottom - EDGE ? Math.ceil((s.y - bottom + EDGE) / 5) : 0;
  if (speed && host.scrollBy(speed)) follow(s.x, s.y);
  frame = requestAnimationFrame(scrollLoop);
}

function start(h: MonthDragHost, item: Item, x: number, y: number, dx: number, dy: number) {
  const grab = h.dayAt(x, y);
  if (!grab) return;
  host = h;
  useMonthDrag.setState({ item, grab, target: grab, x, y, dx, dy });
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  if (frame === null) frame = requestAnimationFrame(scrollLoop);
  // Escape (on the Mac) puts it back: letting go then does nothing.
  beginDrag(cancel);
}

function cancel() {
  finish(false);
}

function finish(drop: boolean) {
  const s = useMonthDrag.getState();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  host = null;
  endDrag(cancel);
  if (!s.item) return;
  useMonthDrag.setState({ item: null, grab: null, target: null });
  if (!drop || !s.grab || !s.target || s.grab === s.target) return;
  const days = diffDaysKey(s.grab, s.target);
  if (s.item.kind === "task") moveTaskByDays(s.item, days);
  else moveEventByDays(s.item, days);
}

/**
 * A task, schedule or event on a month: a tap opens it; touch and hold lifts it to drag to another day (when it can be
 * changed; on the Mac, press and drag). Dimmed where it was while it is dragged.
 */
export function DragPiece({ item, style, onTap, onDoubleTap, children }: { item: Item; style: StyleProp<ViewStyle>; onTap: () => void; onDoubleTap?: () => void; children: ReactNode }) {
  const h = useContext(MonthDragContext);
  const lifted = useMonthDrag((s) => s.item?.key === item.key);
  const movable = !!h && canMove(item);
  const gesture = useMemo(() => {
    const pan = liftPan(350)
      .enabled(movable)
      .runOnJS(true)
      .onStart((e) => h && start(h, item, e.absoluteX, e.absoluteY, e.x, e.y))
      .onUpdate((e) => follow(e.absoluteX, e.absoluteY))
      .onEnd(() => finish(true))
      .onFinalize((_, done) => {
        if (!done) finish(false);
      });
    const tap = Gesture.Tap().runOnJS(true).onEnd(onTap);
    // The Mac: a click chooses it, a double-click opens it (both, as Apple Calendar's clicks do).
    if (onDoubleTap) return Gesture.Exclusive(pan, Gesture.Simultaneous(tap, Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd(onDoubleTap)));
    return Gesture.Exclusive(pan, tap);
  }, [h, item, movable, onTap, onDoubleTap]);
  return (
    <GestureDetector gesture={gesture}>
      <View accessibilityRole="button" accessibilityLabel={item.title} accessibilityHint={movable ? "Touch and hold to move it to another day." : undefined} style={[style, lifted && styles.dim]}>
        {children}
      </View>
    </GestureDetector>
  );
}

/**
 * What is dragged, under the finger, and the day it would go to, lit: laid over the month view (it measures where it is
 * in the window, as the finger's place is the window's).
 */
export function MonthDragLayer({ width, renderGhost }: { width: number; renderGhost: (item: Item) => ReactNode }) {
  const colors = useColors();
  const h = useContext(MonthDragContext);
  const s = useMonthDrag();
  const ref = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const rect = s.item && s.target && h ? h.cellRect(s.target) : null;
  return (
    <View ref={ref} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={() => ref.current?.measureInWindow((x, y) => setOrigin({ x, y }))}>
      {rect ? <View style={[styles.target, { left: rect.x - origin.x, top: rect.y - origin.y, width: rect.w, height: rect.h, backgroundColor: colors.fill, borderColor: colors.label3 }]} /> : null}
      {s.item ? (
        <View style={[styles.ghost, { left: s.x - origin.x - Math.min(s.dx, width - 12), top: s.y - origin.y - s.dy, width }]}>
          {renderGhost(s.item)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.3 },
  target: { position: "absolute", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  ghost: { position: "absolute", opacity: 0.95, transform: [{ scale: 1.08 }], shadowColor: "#000000", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
