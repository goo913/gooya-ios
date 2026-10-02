import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { DetailContent, type DetailHost } from "@/app/sheet/detail";
import { wantEscape } from "@/lib/dragCancel";
import { useMe } from "@/lib/people";
import { ScheduleEditor } from "@/sheets/ScheduleEditor";
import { TaskEditor, type EditorHost } from "@/sheets/TaskEditor";
import { usePrefs } from "@/store/prefs";
import { useColors, useIsDark } from "@/theme";
import { useMac, type Anchor } from "./state";

// Apple Calendar's popover on the Mac (macOS 27): beside what it is about, an arrow pointing at it; 300 points wide,
// rounded, over a light material. A new item's has Event | Reminder at the top (GOOYA's Schedule | Task); the rest is the
// item's form (src/sheets, in their Mac look). It is saved when Return is pressed in the title or when the window is
// clicked anywhere else, and left with Escape (a new item with no title is never saved).

const WIDTH = 320;
const ARROW = 9;
const MARGIN = 10;

/** Where the popover goes for an anchor: at its right (or left, without room), its arrow at the anchor's middle. */
function place(anchor: Anchor, panelH: number, bounds: { width: number; height: number; top: number }) {
  const right = anchor.x + anchor.w + ARROW + 2;
  const side: "left" | "right" = right + WIDTH <= bounds.width - MARGIN ? "right" : "left";
  const x = side === "right" ? right : Math.max(MARGIN, anchor.x - ARROW - 2 - WIDTH);
  const mid = anchor.y + anchor.h / 2;
  const y = Math.max(bounds.top + MARGIN, Math.min(bounds.height - MARGIN - panelH, mid - 40));
  return { x, y, side, arrowY: Math.max(14, Math.min(panelH - 14, mid - y)) };
}

/** The popover layer over the whole window (the calendar's coordinates are the window's). */
export function MacPopoverLayer({ width, height, top }: { width: number; height: number; top: number }) {
  const popover = useMac((s) => s.popover);
  const draft = useMac((s) => s.draft);
  const kind = usePrefs((s) => s.newKind);
  const me = useMe();
  const dark = useIsDark();
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [panelH, setPanelH] = useState(420);
  const open = !!popover;
  useEffect(() => {
    wantEscape("popover", open);
    return () => wantEscape("popover", false);
  }, [open]);
  if (!popover) return null;
  const close = () => useMac.getState().close();
  // A click away saves (a new item only with a title); then it closes.
  const commit = async () => {
    const save = saveRef.current;
    saveRef.current = null;
    if (save) await save();
    close();
  };
  const host: EditorHost = { variant: "mac", register: (save) => (saveRef.current = save), onTitle: popover.kind === "new" ? (t) => useMac.getState().setDraftTitle(t) : undefined };
  const p = place(popover.anchor, panelH, { width, height, top });
  const bg = dark ? "#2c2c2e" : "#fbfbfb";
  const rim = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)";
  const detailHost: DetailHost = { embedded: true, toEditor: close, close };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => void commit()} />
      <View style={[styles.arrow, { backgroundColor: bg, borderColor: rim, top: p.y + p.arrowY - ARROW, left: p.side === "right" ? p.x - ARROW + 1 : p.x + WIDTH - ARROW - 1 }]} />
      {/* The shadow outside, the rounded clip inside (a view that clips draws no shadow). */}
      <View onLayout={(e) => setPanelH(Math.round(e.nativeEvent.layout.height))} style={[styles.shadow, { left: p.x, top: p.y, maxHeight: height - top - 2 * MARGIN }]}>
      <View style={[styles.panel, { backgroundColor: bg, borderColor: rim }]}>
        {popover.kind === "new" && draft ? (
          <>
            <KindSwitch value={kind} onChange={(k) => usePrefs.getState().setNewKind(k)} />
            {kind === "task" ? (
              <TaskEditor key={`task:${draft.date}:${draft.minutes}`} initialOwner={draft.owner ?? me} initialDate={draft.date} initialMinutes={draft.minutes} initialTitle={draft.title} onClose={close} host={host} />
            ) : (
              <ScheduleEditor key={`schedule:${draft.date}:${draft.minutes}`} initialOwner={draft.owner ?? me} initialDate={draft.date} initialMinutes={draft.minutes} initialTitle={draft.title} onClose={close} host={host} />
            )}
          </>
        ) : null}
        {popover.kind === "edit" ? (
          popover.editor.kind === "task" ? (
            <TaskEditor task={popover.editor.task} occ={popover.editor.occ} onClose={close} host={host} />
          ) : (
            <ScheduleEditor event={popover.editor.event} occ={popover.editor.eventOcc} onClose={close} host={host} />
          )
        ) : null}
        {popover.kind === "detail" ? (
          <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
            <DetailContent req={popover.detail} host={detailHost} />
          </ScrollView>
        ) : null}
      </View>
      </View>
      {/* The arrow's join with the panel, over the panel's rim. */}
      <View pointerEvents="none" style={[styles.arrowJoin, { backgroundColor: bg, top: p.y + p.arrowY - ARROW + 1, left: p.side === "right" ? p.x : p.x + WIDTH - 2 }]} />
    </View>
  );
}

/** Apple's Event | Reminder switch at the top of a new item's popover (GOOYA's Schedule | Task). */
function KindSwitch({ value, onChange }: { value: "task" | "schedule"; onChange: (k: "task" | "schedule") => void }) {
  const colors = useColors();
  const dark = useIsDark();
  const options: { value: "task" | "schedule"; label: string }[] = [
    { value: "schedule", label: "Schedule" },
    { value: "task", label: "Task" },
  ];
  return (
    <View style={[styles.kinds, { backgroundColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)" }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.kind, on && { backgroundColor: dark ? "#636366" : "#ffffff", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }]}>
            <Text allowFontScaling={false} style={[styles.kindText, { color: colors.label }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: "absolute", width: WIDTH, borderRadius: 14, shadowColor: "#000000", shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  panel: { flexShrink: 1, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  arrow: { position: "absolute", width: ARROW * 2, height: ARROW * 2, borderWidth: 1, transform: [{ rotate: "45deg" }], shadowColor: "#000000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  arrowJoin: { position: "absolute", width: 2, height: ARROW * 2 - 2 },
  kinds: { flexDirection: "row", marginHorizontal: 10, marginTop: 10, height: 26, borderRadius: 13, padding: 2 },
  kind: { flex: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  kindText: { fontSize: 13 },
  detail: { flexGrow: 0 },
  detailContent: { paddingBottom: 12 },
});
