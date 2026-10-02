import type { DateKey, EventOccurrence, RoutineOccurrence, TaskOccurrence } from "@shared/model";
import { addDaysKey, makeKey, weekdayOfKey } from "@shared/time";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { cancelDrag } from "@/lib/dragCancel";
import { MONTH_NAMES, WEEKDAY_LONG } from "@/lib/format";
import { useMacAgenda, useOpenAtLoginOnce } from "@/lib/mac";
import { useMe } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { usePad, type PadView } from "@/store/pad";
import { usePickers } from "@/store/pickers";
import { usePrefs } from "@/store/prefs";
import { useSheets } from "@/store/sheets";
import { useIsDark } from "@/theme";
import { DayView, type DayActions } from "@/views/DayView";
import { onCommand, openSettings, setMenuState, setSplit, setToolbar } from "../../modules/gooya-mac";
import { INSPECTOR_WIDTH, MacInspector } from "./MacInspector";
import { MacMonth, MacWeekdays, type MacMonthActions } from "./MacMonth";
import { MacPopoverLayer } from "./MacPopover";
import { MacYear, type MacYearActions } from "./MacYear";
import { useMacSidebar } from "./sidebar";
import { useMac, type Anchor } from "./state";
import { useMacColors, ZOOMS } from "./theme";

// GOOYA's calendar on the Mac, as Apple Calendar is on macOS 27: macOS's sidebar at the left and the toolbar over the
// window (modules/gooya-mac); under the toolbar the title ("October 2026"; the Day view's "October 7, 2026" over its
// weekday) with ‹ Today › at the right, then the Day, Week, Month or Year view. New items and an item's details open
// in Apple's popover beside what was clicked (the Day view fills in its pane instead). The menus' commands and keys:
// View's By Day … By Year, Next and Previous, Go to Today, Zoom In and Out; New Schedule or Task, New Routine, New
// Category; Search; Settings; Escape cancels a drag or leaves a popover.

/** The title's row under the toolbar; the Day view's weekday under it. */
const TITLE_H = 54;
const SUBTITLE_H = 34;

type Occ = TaskOccurrence | EventOccurrence | RoutineOccurrence;

export function MacCalendar() {
  const colors = useMacColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const today = useToday();
  const me = useMe();
  // The window (the calendar runs under macOS's sidebar, which is the left inset; the toolbar is the top one).
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const left = insets.left;
  const top = insets.top;
  const width = Math.max(320, size.width - left);
  const view = usePad((s) => s.view);
  const date = usePad((s) => s.date);
  const selectedItem = useMac((s) => s.item);
  const [scrolled, setScrolled] = useState({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });
  const onMonth = useCallback((y: number, m: number) => setScrolled((t) => (t.y === y && t.m === m ? t : { y, m })), []);
  const onYear = useCallback((y: number) => setScrolled((t) => (t.y === y ? t : { y, m: t.m })), []);
  const monthApi = useRef<{ newAt: (day: DateKey) => void } | null>(null);

  // The window's toolbar and sidebar while the calendar shows; the agenda in the menu bar; opening at login.
  useEffect(() => {
    setToolbar(true);
    setSplit(true);
    return () => {
      setToolbar(false);
      setSplit(false);
    };
  }, []);
  useMacAgenda();
  useOpenAtLoginOnce();
  useEffect(() => setMenuState(view), [view]);
  // A popover, a new item or the Day view's chosen item does not outlive the view it was made in.
  useEffect(() => useMac.setState({ popover: null, draft: null, picked: null, item: null }), [view]);

  /** What the toolbar's + points at when the new item's day is not on the screen. */
  const plusAnchor = useMemo<Anchor>(() => ({ x: left + 4, y: 10, w: 36, h: 32 }), [left]);

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

  /** A new schedule or task where it makes sense: the chosen day (else the one shown, or today) at 9 AM. */
  const newHere = useCallback(() => {
    const pad = usePad.getState();
    const day = useMac.getState().day ?? (pad.view === "day" || pad.view === "week" ? pad.date : today);
    if (pad.view === "month" && monthApi.current) monthApi.current.newAt(day);
    else if (pad.view === "day") useMac.getState().newItem(pad.date, 9 * 60, null);
    else useMac.getState().newItem(day, 9 * 60, plusAnchor);
  }, [today, plusAnchor]);

  /** A double-click on an item: its form in the popover, or its details when GOOYA cannot change it. */
  const openItem = useCallback((o: Occ, anchor: Anchor) => {
    const mac = useMac.getState();
    mac.selectItem(o.key);
    if (o.kind === "task") mac.open({ kind: "edit", anchor, editor: { kind: "task", task: o.task, occ: o } });
    else if (o.kind === "event" && (o.event.source === "gooya" || o.event.editable)) mac.open({ kind: "edit", anchor, editor: { kind: "schedule", event: o.event, eventOcc: o } });
    else if (o.kind === "event") mac.open({ kind: "detail", anchor, detail: { kind: "event", eventId: o.event.id, dateKey: o.dateKey } });
    else mac.open({ kind: "detail", anchor, detail: { kind: "routine", routineId: o.routine.id, dateKey: o.dateKey } });
  }, []);

  const showDay = useCallback((key: DateKey) => {
    useMac.getState().close();
    usePad.getState().show("day", key);
  }, []);

  // The menus' and the toolbar's commands, and Escape.
  useEffect(() => {
    const sub = onCommand((id) => {
      const home = pathname === "/";
      const pad = usePad.getState();
      /** A page over the calendar (a list) is left for the calendar first. */
      const toCalendar = () => {
        if (!home) router.dismissTo("/");
      };
      const go = (path: "/search" | "/sheet/edit" | "/sheet/listEdit") => {
        toCalendar();
        setTimeout(() => router.push(path), home ? 0 : 400);
      };
      if (id === "escape") {
        if (!cancelDrag()) useMac.getState().close();
      } else if (id.startsWith("view.")) {
        toCalendar();
        pad.setView(id.slice(5) as PadView);
      } else if (id === "today") {
        toCalendar();
        pad.goToday();
      } else if (id === "next" || id === "previous") step(id === "next" ? 1 : -1);
      else if (id === "zoom.in" || id === "zoom.out") {
        const z = usePrefs.getState().itemZoom;
        const i = ZOOMS.reduce((best, v, k) => (Math.abs(v - z) < Math.abs(ZOOMS[best] - z) ? k : best), 0);
        usePrefs.getState().setItemZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (id === "zoom.in" ? 1 : -1)))]);
      } else if (id === "new") {
        toCalendar();
        newHere();
      } else if (id === "new.routine") {
        useSheets.getState().openEditor({ kind: "routine", initialOwner: me, initialDate: useMac.getState().day ?? pad.date });
        go("/sheet/edit");
      } else if (id === "new.category") {
        usePickers.getState().setList(null);
        go("/sheet/listEdit");
      } else if (id === "search") go("/search");
      // The menus open Settings themselves (a window of its own); this is for the same commands from anywhere else.
      else if (id === "settings") openSettings();
      else if (id === "accounts") openSettings("accounts");
    });
    return () => sub?.remove();
  }, [pathname, step, newHere, me]);

  // The sidebar: its ticks, a category or task list opened, a day of its month shown.
  useMacSidebar({
    openList: (id) => {
      if (pathname !== "/") router.dismissTo("/");
      router.push({ pathname: "/lists/[id]", params: { id } });
    },
    showDate: (key) => {
      const pad = usePad.getState();
      pad.show(pad.view, pad.view === "month" ? makeKey(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1) : key);
      useMac.getState().selectDay(key);
    },
  });

  const monthActions = useMemo<MacMonthActions>(() => ({ showDay, openItem }), [showDay, openItem]);
  const yearActions = useMemo<MacYearActions>(() => ({ showDay, showMonth: (key) => usePad.getState().show("month", key) }), [showDay]);
  const weekActions = useMemo<DayActions>(
    () => ({
      openTask: (o, a) => openItem(o, a ?? plusAnchor),
      openEvent: (o, a) => openItem(o, a ?? plusAnchor),
      openRoutine: (o, a) => openItem(o, a ?? plusAnchor),
      editTask: (occ) => {
        useSheets.getState().openEditor({ kind: "task", task: occ.task, occ });
        router.push("/sheet/edit");
      },
      editRoutine: (occ, dayOnly) => {
        useSheets.getState().openEditor({ kind: "routine", routine: occ.routine, dayOnly: dayOnly ? occ.dateKey : undefined });
        router.push("/sheet/edit");
      },
      createTask: (d, person, minutes) => useMac.getState().newItem(d, minutes, plusAnchor, person),
      select: (o) => useMac.getState().selectItem(o?.key ?? null),
      newAt: (d, minutes, anchor, person) => useMac.getState().newItem(d, minutes, anchor, person),
    }),
    [openItem, plusAnchor],
  );
  const dayActions = useMemo<DayActions>(
    () => ({
      ...weekActions,
      // The Day view's pane shows what is chosen (a click is enough, as in Apple's), and fills in a new item.
      openTask: (o) => useMac.getState().pick(o),
      openEvent: (o) => useMac.getState().pick(o),
      openRoutine: (o) => useMac.getState().pick(o),
      createTask: (d, person, minutes) => useMac.getState().newItem(d, minutes, null, person),
      select: (o) => {
        const mac = useMac.getState();
        if (o) mac.pick(o);
        else if (mac.commit) void mac.commit();
        else mac.pick(null);
      },
      newAt: (d, minutes, _anchor, person) => useMac.getState().newItem(d, minutes, null, person),
    }),
    [weekActions],
  );

  const title = view === "day" || view === "week" ? { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) } : scrolled;
  const nav = <Nav onStep={step} onToday={() => usePad.getState().goToday()} />;
  const inspectorW = Math.round(Math.min(INSPECTOR_WIDTH, width * 0.42));
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <View style={[styles.content, { left, top }]}>
        {view === "day" ? (
          <View style={styles.row}>
            <View style={{ width: width - inspectorW }}>
              <View style={[styles.titleRow, { height: TITLE_H + SUBTITLE_H }]}>
                <DayTitle date={date} />
              </View>
              <DayView dateKey={date} onChangeDate={(k) => usePad.getState().setDate(k)} actions={dayActions} width={width - inspectorW} days={1} chrome={false} selectedKey={selectedItem} pad mac onShowDay={showDay} />
            </View>
            <MacInspector width={inspectorW} date={date} onPickDate={(k) => usePad.getState().setDate(k)} nav={nav} />
          </View>
        ) : (
          <>
            <View style={[styles.titleRow, { height: TITLE_H }]}>
              <Title month={view === "year" ? null : MONTH_NAMES[title.m - 1]} year={title.y} />
              {nav}
            </View>
            {view === "month" ? (
              <>
                <MacWeekdays width={width} />
                <MacMonth width={width} onMonth={onMonth} actions={monthActions} apiRef={monthApi} />
              </>
            ) : null}
            {view === "year" ? <MacYear width={width} onYear={onYear} actions={yearActions} /> : null}
            {view === "week" ? <DayView dateKey={addDaysKey(date, -weekdayOfKey(date))} onChangeDate={(k) => usePad.getState().setDate(k)} actions={weekActions} width={width} days={7} merged chrome={false} selectedKey={selectedItem} pad mac onShowDay={showDay} /> : null}
          </>
        )}
      </View>
      <MacPopoverLayer width={size.width} height={size.height} top={top} />
    </View>
  );
}

/** "October 2026" (the month bold, the year not), or the year alone; 30 points. */
function Title({ month, year }: { month: string | null; year: number }) {
  const colors = useMacColors();
  return (
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: colors.text }]}>
      {month ? (
        <>
          {month}
          <Text style={styles.regular}> {year}</Text>
        </>
      ) : (
        <Text style={styles.regular}>{year}</Text>
      )}
    </Text>
  );
}

/** The Day view's "October 7, 2026" over "Wednesday". */
function DayTitle({ date }: { date: DateKey }) {
  const colors = useMacColors();
  const [y, m, d] = date.split("-").map(Number);
  return (
    <View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: colors.text }]}>
        {MONTH_NAMES[m - 1]} {d},<Text style={styles.regular}> {y}</Text>
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.subtitle, { color: colors.text }]}>
        {WEEKDAY_LONG[weekdayOfKey(date)]}
      </Text>
    </View>
  );
}

/** ‹ Today ›: grey circles and a capsule, 24 points high. */
function Nav({ onStep, onToday }: { onStep: (dir: 1 | -1) => void; onToday: () => void }) {
  const colors = useMacColors();
  const dark = useIsDark();
  const fill = dark ? "rgba(255,255,255,0.1)" : "#ececec";
  return (
    <View style={styles.nav}>
      <NavButton label="Previous" fill={fill} onPress={() => onStep(-1)}>
        <Icon name="chevron.left" size={11} weight="semibold" color={colors.text} />
      </NavButton>
      <NavButton label="Today" fill={fill} wide onPress={onToday}>
        <Text allowFontScaling={false} style={[styles.today, { color: colors.text }]}>
          Today
        </Text>
      </NavButton>
      <NavButton label="Next" fill={fill} onPress={() => onStep(1)}>
        <Icon name="chevron.right" size={11} weight="semibold" color={colors.text} />
      </NavButton>
    </View>
  );
}

function NavButton({ label, fill, wide, onPress, children }: { label: string; fill: string; wide?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.navButton, wide && styles.navWide, { backgroundColor: fill }, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { position: "absolute", right: 0, bottom: 0 },
  row: { flex: 1, flexDirection: "row" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 14 },
  title: { fontSize: 30, fontWeight: "700", flexShrink: 1 },
  regular: { fontWeight: "400" },
  subtitle: { fontSize: 20, marginTop: 6 },
  nav: { flexDirection: "row", alignItems: "center", gap: 5 },
  navButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  navWide: { width: undefined, paddingHorizontal: 14 },
  today: { fontSize: 13 },
  pressed: { opacity: 0.6 },
});
