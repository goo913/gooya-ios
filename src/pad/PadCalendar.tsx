import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { addDaysKey, makeKey, weekdayOfKey } from "@shared/time";
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DetailContent, EventAnswers, type DetailHost } from "@/app/sheet/detail";
import { MONTH_NAMES, WEEKDAY_SHORT } from "@/lib/format";
import { useMacAgenda, useOpenAtLoginOnce } from "@/lib/mac";
import { useMe } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { usePad, type PadView } from "@/store/pad";
import { usePrefs } from "@/store/prefs";
import { useSheets, type DetailRequest, type EditorRequest } from "@/store/sheets";
import { useColors, type Colors } from "@/theme";
import { DayView, type DayActions } from "@/views/DayView";
import { isMac, onCommand, setMenuState } from "../../modules/gooya-mac";
import { PadMonth, PadWeekdays } from "./PadMonth";
import { PadSidebar, SIDEBAR_WIDTH } from "./PadSidebar";
import { MAC_TOOLBAR, PAD_HEADER, PadTitle, PadToolbar } from "./PadToolbar";
import { PadYear } from "./PadYear";

/**
 * The iPad's calendar, after Apple Calendar for iPad (iPadOS 27): one screen with the bar at the top, the title under
 * it, and the Day, Week, Month or Year view. The Day view keeps the chosen item's details beside the day, as Apple's
 * does; elsewhere they open as a sheet.
 *
 * The Mac's too (Apple Calendar on macOS 27): the bar in the window's title bar, the sidebar (people and calendars) at
 * the left when shown, and the menus' commands and keyboard shortcuts (modules/gooya-mac).
 */
export function PadCalendar() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const view = usePad((s) => s.view);
  const date = usePad((s) => s.date);
  const sidebar = usePrefs((s) => s.sidebar) && isMac;
  const sideW = sidebar ? SIDEBAR_WIDTH : 0;
  const width = windowW - sideW;
  const me = useMe();
  const openDetail = useSheets((s) => s.openDetail);
  const openEditor = useSheets((s) => s.openEditor);
  // Day and Week are titled by their day; Month and Year by what is scrolled to.
  const [scrolled, setScrolled] = useState<{ y: number; m: number }>({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });
  const onMonth = useCallback((y: number, m: number) => setScrolled((t) => (t.y === y && t.m === m ? t : { y, m })), []);
  const onYear = useCallback((y: number) => setScrolled((t) => (t.y === y ? t : { y, m: t.m })), []);
  const title = view === "day" || view === "week" ? { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) } : scrolled;

  const openSheet = useCallback(
    (o: TaskOccurrence | EventOccurrence) => {
      if (o.kind === "event") openDetail({ kind: "event", eventId: o.event.id, dateKey: o.dateKey });
      else openDetail({ kind: "task", taskId: o.task.id, dateKey: o.dateKey });
      router.push("/sheet/detail");
    },
    [openDetail],
  );
  const newItem = useCallback(
    (d: DateKey, minutes?: number, kind: EditorRequest["kind"] = "task") => {
      openEditor({ kind, initialOwner: me, initialDate: d, initialMinutes: minutes });
      router.push("/sheet/edit");
    },
    [me, openEditor],
  );
  const onHoldDay = useCallback(
    (key: DateKey) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      newItem(key);
    },
    [newItem],
  );
  const onPickDay = useCallback((key: DateKey) => usePad.getState().show("day", key), []);
  const onPickMonth = useCallback((key: DateKey) => usePad.getState().show("month", key), []);
  const onToday = useCallback(() => {
    usePad.getState().goToday();
  }, []);
  // ‹ › on the Mac, and the View menu's Next and Previous: a day, a week, the month or the year shown.
  const step = useCallback(
    (dir: 1 | -1) => {
      const pad = usePad.getState();
      if (pad.view === "day") pad.show("day", addDaysKey(pad.date, dir));
      else if (pad.view === "week") pad.show("week", addDaysKey(pad.date, 7 * dir));
      else if (pad.view === "month") {
        const m0 = scrolled.y * 12 + scrolled.m - 1 + dir;
        pad.show("month", makeKey(Math.floor(m0 / 12), (m0 % 12) + 1, 1));
      } else pad.show("year", makeKey(scrolled.y + dir, 1, 1));
    },
    [scrolled],
  );

  // The Mac's menus: the View menu ticks the view shown; the commands do what the bar's buttons do. New items, Search
  // and Settings only from the calendar itself (not over a sheet).
  const pathname = usePathname();
  useMacAgenda();
  useOpenAtLoginOnce();
  useEffect(() => setMenuState(view, sidebar), [view, sidebar]);
  useEffect(() => {
    const sub = onCommand((id) => {
      const atHome = pathname === "/";
      if (id.startsWith("view.")) usePad.getState().setView(id.slice(5) as PadView);
      else if (id === "today") onToday();
      else if (id === "next" || id === "previous") step(id === "next" ? 1 : -1);
      else if (id === "sidebar") usePrefs.getState().setSidebar(!usePrefs.getState().sidebar);
      else if (!atHome) return;
      else if (id === "new.task" || id === "new.schedule" || id === "new.routine") newItem(date, undefined, id.slice(4) as EditorRequest["kind"]);
      else if (id === "search") router.push("/search");
      else if (id === "lists") router.push("/lists");
      else if (id === "settings") router.push("/settings");
    });
    return () => sub?.remove();
  }, [pathname, onToday, step, newItem, date]);

  // On the Mac the bar is in the window's title bar, above the safe area.
  const headerH = (isMac ? 0 : insets.top) + PAD_HEADER;
  const header = (
    <>
      <PadToolbar
        width={windowW}
        onCalendars={isMac ? () => usePrefs.getState().setSidebar(!sidebar) : () => router.push("/calendars")}
        onLists={() => router.push("/lists")}
        onSettings={() => router.push("/settings")}
        onAdd={() => newItem(date)}
        onSearch={() => router.push("/search")}
      />
      <PadTitle month={view === "year" ? null : MONTH_NAMES[title.m - 1]} year={title.y} onToday={onToday} onStep={step} left={sideW} />
    </>
  );

  return (
    <View style={[styles.fill, styles.row, { backgroundColor: colors.bg }]}>
      {sidebar ? <PadSidebar top={MAC_TOOLBAR} /> : null}
      <View style={{ width }}>
        <View style={{ height: headerH, backgroundColor: view === "day" || view === "week" ? colors.bar : colors.bg }} />
        {view === "month" ? (
          <>
            <PadWeekdays width={width} />
            <PadMonth width={width} onMonth={onMonth} onPickDay={onPickDay} onHoldDay={onHoldDay} onOpen={openSheet} />
          </>
        ) : null}
        {view === "year" ? <PadYear width={width} onYear={onYear} onPickMonth={onPickMonth} /> : null}
        {view === "week" ? <PadWeek width={width} /> : null}
        {view === "day" ? <PadDay width={width} /> : null}
      </View>
      {header}
    </View>
  );
}

/** Opens what a day view's item asks for: details in a sheet (the week) or in the pane (the day), editors as sheets. */
function useDayActions(open: (req: DetailRequest, key: string) => void): DayActions {
  const openEditor = useSheets((s) => s.openEditor);
  return useMemo<DayActions>(
    () => ({
      openTask: (occ) => open({ kind: "task", taskId: occ.task.id, dateKey: occ.dateKey }, occ.key),
      openRoutine: (occ) => open({ kind: "routine", routineId: occ.routine.id, dateKey: occ.dateKey }, occ.key),
      openEvent: (occ) => open({ kind: "event", eventId: occ.event.id, dateKey: occ.dateKey }, occ.key),
      editTask: (occ) => {
        openEditor({ kind: "task", task: occ.task, occ });
        router.push("/sheet/edit");
      },
      editRoutine: (occ, dayOnly) => {
        openEditor({ kind: "routine", routine: occ.routine, dayOnly: dayOnly ? occ.dateKey : undefined });
        router.push("/sheet/edit");
      },
      createTask: (d, person, minutes) => {
        openEditor({ kind: "task", initialDate: d, initialOwner: person, initialMinutes: minutes });
        router.push("/sheet/edit");
      },
    }),
    [open, openEditor],
  );
}

function PadWeek({ width }: { width: number }) {
  const date = usePad((s) => s.date);
  const setDate = usePad((s) => s.setDate);
  const openDetail = useSheets((s) => s.openDetail);
  const open = useCallback(
    (req: DetailRequest) => {
      openDetail(req);
      router.push("/sheet/detail");
    },
    [openDetail],
  );
  const actions = useDayActions(open);
  const sunday = addDaysKey(date, -weekdayOfKey(date));
  return <DayView dateKey={sunday} onChangeDate={(k) => setDate(k)} actions={actions} width={width} days={7} merged chrome={false} pad />;
}

/** Apple's iPad Day view: the week along the top, the day's hours at the left, the chosen item's details at the right. */
function PadDay({ width }: { width: number }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const date = usePad((s) => s.date);
  const setDate = usePad((s) => s.setDate);
  const selected = usePad((s) => s.selected);
  const selectedKey = usePad((s) => s.selectedKey);
  const select = usePad((s) => s.select);
  const open = useCallback((req: DetailRequest, key: string) => select(req, key), [select]);
  const actions = useDayActions(open);
  // Apple's pane is 376 points wide at any width that leaves the day room.
  const paneW = Math.round(Math.min(376, width * 0.46));
  const host = useMemo<DetailHost>(() => ({ embedded: true, toEditor: () => router.push("/sheet/edit"), close: () => select(null) }), [select]);
  return (
    <View style={styles.fill}>
      <PadStrip width={width} colors={colors} />
      <View style={styles.row}>
        <View style={{ width: width - paneW }}>
          <DayView dateKey={date} onChangeDate={setDate} actions={actions} width={width - paneW} days={1} chrome={false} selectedKey={selectedKey} pad />
        </View>
        <View style={[styles.pane, { width: paneW, borderLeftColor: colors.separator, backgroundColor: colors.bg }]}>
          {selected ? (
            <>
              <ScrollView key={`${selected.kind}:${selectedKey}`} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
                <DetailContent req={selected} host={host} />
              </ScrollView>
              {selected.kind === "event" ? <EventAnswers eventId={selected.eventId} /> : null}
            </>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.label }]}>No Event Selected</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** "Sun 27  Mon 28  Tue 29 …" across the top of the Day view; swipe for the next week, tap a day to show it. */
function PadStrip({ width, colors }: { width: number; colors: Colors }) {
  const date = usePad((s) => s.date);
  const setDate = usePad((s) => s.setDate);
  const today = useToday();
  const ref = useRef<ScrollView>(null);
  const weekStart = addDaysKey(date, -weekdayOfKey(date));
  const weeks = [-1, 0, 1].map((p) => addDaysKey(weekStart, p * 7));
  const inner = width - 32;
  useEffect(() => {
    ref.current?.scrollTo({ x: width, animated: false });
  }, [weekStart, width]);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== 1) setDate(addDaysKey(date, (page - 1) * 7));
  };
  return (
    <View style={[styles.strip, { backgroundColor: colors.bar, borderBottomColor: colors.separator }]}>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: width, y: 0 }} onMomentumScrollEnd={onEnd}>
        {weeks.map((ws) => (
          <View key={ws} style={[styles.stripWeek, { width, paddingHorizontal: 16 }]}>
            {Array.from({ length: 7 }, (_, i) => {
              const key = addDaysKey(ws, i);
              const isToday = key === today;
              const sel = key === date;
              const weekend = i === 0 || i === 6;
              const d = Number(key.slice(8, 10));
              return (
                <Pressable key={key} accessibilityRole="button" accessibilityLabel={`day ${key}`} accessibilityState={{ selected: sel }} onPress={() => setDate(key)} style={[styles.stripDay, { width: inner / 7 }]}>
                  <Text allowFontScaling={false} style={[styles.stripText, { color: weekend ? colors.label2 : colors.label }]}>
                    {WEEKDAY_SHORT[i]}{" "}
                  </Text>
                  <View style={[styles.stripNum, sel && { backgroundColor: isToday ? colors.red : colors.label }]}>
                    <Text allowFontScaling={false} style={[styles.stripText, { color: sel ? (isToday ? "#ffffff" : colors.bg) : isToday ? colors.red : weekend ? colors.label2 : colors.label, fontWeight: sel ? "600" : "400" }]}>
                      {d}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row" },
  pane: { borderLeftWidth: StyleSheet.hairlineWidth },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 27, fontWeight: "700" },
  strip: { height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  stripWeek: { flexDirection: "row", alignItems: "center" },
  stripDay: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  stripText: { fontSize: 17 },
  stripNum: { minWidth: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
});
