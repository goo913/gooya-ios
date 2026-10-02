import type { DateKey, EventOccurrence, RoutineOccurrence, TaskOccurrence } from "@shared/model";
import { addDaysKey, makeKey, weekdayOfKey } from "@shared/time";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { DetailContent, type DetailHost } from "@/app/sheet/detail";
import { WEEKDAY_LETTERS } from "@/lib/format";
import { useMe } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { ScheduleEditor } from "@/sheets/ScheduleEditor";
import { TaskEditor, type EditorHost } from "@/sheets/TaskEditor";
import { usePrefs } from "@/store/prefs";
import { useIsDark } from "@/theme";
import { useMac } from "./state";
import { useMacColors, useWindowActive, type MacColors } from "./theme";

// The pane at the right of Apple Calendar's Day view on the Mac (macOS 27), 388 points wide in a grey a shade off the
// window's: the day's month at the top (the day shown in a dark circle, today's number red), and under it the chosen
// item's form; a new item made in the day (a double-click on an empty time) is filled in here, not in a popover.

export const INSPECTOR_WIDTH = 388;

type Occ = TaskOccurrence | EventOccurrence | RoutineOccurrence;

export function MacInspector({ width, date, onPickDate, nav }: { width: number; date: DateKey; onPickDate: (key: DateKey) => void; nav: React.ReactNode }) {
  const colors = useMacColors();
  const picked = useMac((s) => s.picked);
  const draft = useMac((s) => s.draft);
  const popover = useMac((s) => s.popover);
  return (
    <View style={[styles.pane, { width, backgroundColor: colors.pane, borderLeftColor: colors.line }]}>
      <View style={styles.top}>
        <MiniMonth date={date} onPick={onPickDate} colors={colors} />
        <View style={styles.nav}>{nav}</View>
      </View>
      {draft && !popover ? <NewHere /> : picked ? <Picked key={picked.key} occ={picked} /> : null}
    </View>
  );
}

/** A new item made in the Day view: Schedule | Task, then its form (saved with Return, or when the window is clicked elsewhere). */
function NewHere() {
  const draft = useMac((s) => s.draft)!;
  const kind = usePrefs((s) => s.newKind);
  const me = useMe();
  const dark = useIsDark();
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const close = () => useMac.getState().close();
  const host: EditorHost = { variant: "mac", register: (save) => (saveRef.current = save), onTitle: (t) => useMac.getState().setDraftTitle(t) };
  // A click elsewhere in the day saves it (with a title), as a click away from Apple's popover does.
  useEffect(() => {
    useMac.setState({
      commit: async () => {
        const save = saveRef.current;
        saveRef.current = null;
        if (save) await save();
        useMac.getState().close();
      },
    });
    return () => useMac.setState({ commit: null });
  }, []);
  return (
    <View style={styles.form}>
      <View style={[styles.kinds, { backgroundColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)" }]}>
        {(["schedule", "task"] as const).map((k) => (
          <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: k === kind }} onPress={() => usePrefs.getState().setNewKind(k)} style={[styles.kind, k === kind && { backgroundColor: dark ? "#636366" : "#ffffff" }]}>
            <Text allowFontScaling={false} style={[styles.kindText, { color: dark ? "#ffffff" : "#000000" }]}>
              {k === "schedule" ? "Schedule" : "Task"}
            </Text>
          </Pressable>
        ))}
      </View>
      {kind === "task" ? (
        <TaskEditor key={`t:${draft.date}:${draft.minutes}`} initialOwner={draft.owner ?? me} initialDate={draft.date} initialMinutes={draft.minutes} initialTitle={draft.title} onClose={close} host={host} />
      ) : (
        <ScheduleEditor key={`s:${draft.date}:${draft.minutes}`} initialOwner={draft.owner ?? me} initialDate={draft.date} initialMinutes={draft.minutes} initialTitle={draft.title} onClose={close} host={host} />
      )}
    </View>
  );
}

/** The chosen item: its form when GOOYA can change it, its details otherwise (a routine, a read-only event). */
function Picked({ occ }: { occ: Occ }) {
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const close = () => useMac.getState().pick(null);
  const host: EditorHost = { variant: "mac", register: (save) => (saveRef.current = save) };
  const detailHost: DetailHost = { embedded: true, toEditor: close, close };
  if (occ.kind === "task") return <TaskEditor task={occ.task} occ={occ} onClose={close} host={host} />;
  if (occ.kind === "event" && (occ.event.source === "gooya" || occ.event.editable)) return <ScheduleEditor event={occ.event} occ={occ} onClose={close} host={host} />;
  return (
    <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
      <DetailContent req={occ.kind === "event" ? { kind: "event", eventId: occ.event.id, dateKey: occ.dateKey } : { kind: "routine", routineId: occ.routine.id, dateKey: occ.dateKey }} host={detailHost} />
    </ScrollView>
  );
}

/** Apple's month at the top of the pane: the weekdays' letters and six weeks; a day clicked is shown. */
function MiniMonth({ date, onPick, colors }: { date: DateKey; onPick: (key: DateKey) => void; colors: MacColors }) {
  const today = useToday();
  const active = useWindowActive();
  const first = makeKey(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1);
  const start = addDaysKey(first, -weekdayOfKey(first));
  const month = date.slice(0, 7);
  return (
    <View>
      <View style={styles.miniRow}>
        {WEEKDAY_LETTERS.map((l, i) => (
          <Text key={i} allowFontScaling={false} style={[styles.miniLetter, { color: colors.text2 }]}>
            {l}
          </Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, r) => (
        <View key={r} style={styles.miniRow}>
          {Array.from({ length: 7 }, (_, c) => {
            const key = addDaysKey(start, r * 7 + c);
            const isShown = key === date;
            const isToday = key === today;
            const inMonth = key.startsWith(month);
            return (
              <Pressable key={c} accessibilityRole="button" accessibilityLabel={key} onPress={() => onPick(key)} style={styles.miniCell}>
                <View style={[styles.miniMark, isShown && { backgroundColor: isToday ? (active ? colors.red : colors.inactive) : colors.text }]}>
                  <Text allowFontScaling={false} style={[styles.miniDay, { color: isShown ? colors.bg : isToday ? colors.red : inMonth ? colors.text : colors.faded, fontWeight: isShown || isToday ? "600" : "400" }]}>
                    {Number(key.slice(8, 10))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { borderLeftWidth: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 12, paddingRight: 12, paddingTop: 14, paddingBottom: 10 },
  nav: { paddingTop: 2 },
  form: { flex: 1 },
  miniRow: { flexDirection: "row", height: 18, alignItems: "center" },
  miniLetter: { width: 28, textAlign: "center", fontSize: 10, fontWeight: "500" },
  miniCell: { width: 28, height: 18, alignItems: "center", justifyContent: "center" },
  miniMark: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  miniDay: { fontSize: 11, fontVariant: ["tabular-nums"] },
  kinds: { flexDirection: "row", marginHorizontal: 10, marginTop: 4, height: 26, borderRadius: 13, padding: 2 },
  kind: { flex: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  kindText: { fontSize: 13 },
});
