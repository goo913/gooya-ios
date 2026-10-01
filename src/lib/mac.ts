import type { DateKey, EventOccurrence, TaskOccurrence } from "@shared/model";
import { PEOPLE, PERSON_KEYS } from "@shared/people";
import { taskColor } from "@shared/categories";
import { formatTime12 } from "@shared/fmt";
import { addDaysKey, startOfDayMs, weekdayOfKey } from "@shared/time";
import { router } from "expo-router";
import { useEffect, useMemo } from "react";
import { useData } from "@/store/data";
import { usePad } from "@/store/pad";
import { usePrefs } from "@/store/prefs";
import { useSheets } from "@/store/sheets";
import { useIsDark } from "@/theme";
import { hideAgenda, isMac, onAgendaSelect, setAgenda, setOpenAtLogin, type AgendaRow } from "../../modules/gooya-mac";
import { MONTH_SHORT, WEEKDAY_SHORT } from "./format";
import { useEventsByDay, useTasksByDay } from "./occurrences";
import { colorHex, listIndexOf, useMe } from "./people";
import { useToday, viewerTz } from "./useNow";

/**
 * GOOYA's agenda in the Mac's menu bar (Settings → Show in Menu Bar): what is on today and tomorrow for both of you, as
 * on the widget, each with its colour and time; choosing one opens its day with its details beside it. Then New Task…
 * and Open GOOYA. Kept up to date while GOOYA runs (also with its window closed).
 */
export function useMacAgenda(): void {
  const on = usePrefs((s) => s.menuBarAgenda) && isMac;
  const today = useToday();
  const tomorrow = addDaysKey(today, 1);
  const start = startOfDayMs(today, viewerTz);
  const end = startOfDayMs(addDaysKey(today, 2), viewerTz);
  const tasks = useTasksByDay(start, end, PERSON_KEYS, viewerTz);
  const events = useEventsByDay(start, end, PERSON_KEYS, viewerTz);
  const users = useData((s) => s.users);
  const lists = useData((s) => s.lists);
  const dark = useIsDark();
  const me = useMe();

  const sections = useMemo(() => {
    const byId = listIndexOf(lists);
    const personHex = (key: keyof typeof PEOPLE) => colorHex(users[key]?.color || PEOPLE[key].color, dark);
    const time = (o: { allDay: boolean; start: number }) => (o.allDay ? "all-day" : formatTime12(o.start, viewerTz));
    const eventRow = (o: EventOccurrence): AgendaRow => ({ key: `event|${o.event.id}|${o.dateKey}|${o.key}`, title: o.title, detail: time(o), color: o.event.color || personHex(o.event.owner) });
    const taskRow = (o: TaskOccurrence): AgendaRow => ({ key: `task|${o.task.id}|${o.dateKey}|${o.key}`, title: o.title, detail: time(o), color: taskColor(o.task, byId) ?? personHex(o.task.owner) });
    const day = (key: DateKey, name: string) => {
      const evs = events.get(key) ?? [];
      const open = (tasks.get(key) ?? []).filter((t) => !t.completed);
      const rows = [...evs.map((o) => ({ o, row: eventRow(o) })), ...open.map((o) => ({ o, row: taskRow(o) }))]
        .sort((a, b) => (a.o.allDay !== b.o.allDay ? (a.o.allDay ? -1 : 1) : a.o.start - b.o.start))
        .map((x) => x.row);
      return { title: `${name} · ${WEEKDAY_SHORT[weekdayOfKey(key)]}, ${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8))}`, rows };
    };
    return [day(today, "Today"), day(tomorrow, "Tomorrow")];
  }, [events, tasks, users, lists, dark, today, tomorrow]);

  useEffect(() => {
    if (!isMac) return;
    if (!on) return hideAgenda();
    setAgenda(sections, [
      { key: "new", title: "New Task…" },
      { key: "open", title: "Open GOOYA" },
    ]);
  }, [on, sections]);

  // A chosen row: its day in the Day view with its details beside it (from wherever GOOYA was).
  useEffect(() => {
    const sub = onAgendaSelect((key) => {
      const [kind, id, dateKey, occKey] = key.split("|");
      if (kind === "new") {
        router.dismissTo("/");
        useSheets.getState().openEditor({ kind: "task", initialOwner: me, initialDate: usePad.getState().date });
        router.push("/sheet/edit");
        return;
      }
      if (kind !== "task" && kind !== "event") return;
      router.dismissTo("/");
      const pad = usePad.getState();
      pad.show("day", dateKey as DateKey);
      pad.select(kind === "task" ? { kind: "task", taskId: id, dateKey: dateKey as DateKey } : { kind: "event", eventId: id, dateKey: dateKey as DateKey }, occKey);
    });
    return () => sub?.remove();
  }, [me]);
}

/**
 * GOOYA opens at login on the Mac, as asked for when the Mac app was made: set once, the first time it runs; Settings →
 * Mac → Open at Login turns it off (and macOS's Login Items).
 */
export function useOpenAtLoginOnce(): void {
  const hydrated = usePrefs((s) => s.hydrated);
  const done = usePrefs((s) => s.loginItemSetUp);
  useEffect(() => {
    if (!isMac || !hydrated || done) return;
    usePrefs.getState().setLoginItemSetUp();
    void setOpenAtLogin(true).catch(() => undefined);
  }, [hydrated, done]);
}
