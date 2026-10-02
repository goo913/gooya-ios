import { categoriesOf, categoryOfList } from "@shared/categories";
import type { DateKey } from "@shared/model";
import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { useEffect, useMemo, useRef } from "react";
import { SMART, useListOccurrences } from "@/lib/listOccurrences";
import { colorHex, listIndexOf, peopleForFilter, useFilteredPeople, useMe, usePerson } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { useData } from "@/store/data";
import { usePrefs } from "@/store/prefs";
import { useIsDark } from "@/theme";
import { onSidebar, setSidebar, type SidebarSection } from "../../modules/gooya-mac";

/**
 * The Mac's sidebar (macOS's own, modules/gooya-mac GooyaMacSidebar), laid out as Apple Calendar's calendar list: a
 * heading per kind and each calendar with a tick in its colour. GOOYA's: whose items show (both people), GOOYA's
 * schedules, each connected account's calendars, the categories (a tick shows or hides a category's tasks and
 * schedules; choosing one opens its list, with its count of open tasks), and the task lists Reminders has (Today,
 * Scheduled, All, Flagged, Completed). The month at the bottom shows a day it is clicked on.
 */
export function useMacSidebar({ openList, showDate }: { openList: (id: string) => void; showDate: (key: DateKey) => void }): void {
  const dark = useIsDark();
  const me = useMe();
  const today = useToday();
  const filter = usePrefs((s) => s.filter);
  const hidden = usePrefs((s) => s.hiddenCalendars);
  const accounts = useData((s) => s.accounts);
  const lists = useData((s) => s.lists);
  const gooya = usePerson("gooya");
  const eunbi = usePerson("eunbi");
  const people = useFilteredPeople();
  const occ = useListOccurrences(people, today);
  const included = peopleForFilter(me, filter);

  const sections = useMemo<SidebarSection[]>(() => {
    const open = occ.filter((o) => !o.completed);
    const byId = listIndexOf(lists);
    const perCategory = new Map<string, number>();
    for (const o of open) {
      const key = categoryOfList(o.task.listId, byId)?.id ?? o.task.listId;
      perCategory.set(key, (perCategory.get(key) ?? 0) + 1);
    }
    const counts: Record<string, number> = {
      today: open.filter((o) => o.dueDate && o.dueDate <= today).length,
      scheduled: open.filter((o) => !!o.dueDate).length,
      all: open.length,
      flagged: open.filter((o) => o.task.flagged).length,
      completed: occ.filter((o) => o.completed).length,
    };
    const out: SidebarSection[] = [
      {
        id: "people",
        title: "People",
        rows: PERSON_KEYS.map((key) => {
          const p = key === "gooya" ? gooya : eunbi;
          return { id: `person:${key}`, title: key === me ? `${p.name} (Me)` : p.name, color: colorHex(p.color, dark), checked: included.includes(key) };
        }),
      },
      { id: "gooya", title: "GOOYA", rows: [{ id: "cal:gooya:schedules", title: "Schedules", color: dark ? "#0a84ff" : "#007aff", checked: !hidden.includes("gooya:schedules") }] },
    ];
    for (const a of accounts) {
      const calendars = Object.entries(a.calendars ?? {}).filter(([, c]) => c.direction === "import" || c.direction === "both");
      if (!calendars.length) continue;
      out.push({
        id: `account:${a.id}`,
        title: a.source === "google" ? "Google" : "iCloud",
        rows: calendars.map(([calId, c]) => ({ id: `cal:${a.id}:${calId}`, title: c.name, color: c.color, checked: !hidden.includes(`${a.id}:${calId}`) })),
      });
    }
    const categories = categoriesOf(lists);
    if (categories.length) {
      out.push({
        id: "categories",
        title: "Categories",
        rows: categories.map((c) => ({ id: `category:${c.id}`, title: c.name, color: c.color, checked: !hidden.includes(`category:${c.id}`), count: String(perCategory.get(c.id) ?? 0) })),
      });
    }
    out.push({
      id: "lists",
      title: "Task Lists",
      rows: SMART.map((s) => ({ id: `smart:${s.key}`, title: s.label, icon: s.icon === "calendar" && s.key === "today" ? "calendar.circle.fill" : s.key === "scheduled" ? "calendar.badge.clock" : s.icon, iconColor: s.color, count: String(counts[s.key] ?? 0) })),
    });
    return out;
  }, [occ, lists, today, accounts, hidden, gooya, eunbi, me, dark, included]);

  const sent = useRef("");
  useEffect(() => {
    const json = JSON.stringify([sections, today]);
    if (json === sent.current) return;
    sent.current = json;
    setSidebar(sections, today);
  }, [sections, today]);

  // Its clicks: a tick shows or hides; a category or task list opens; a day of its month is shown.
  const latest = useRef({ openList, showDate, me });
  useEffect(() => {
    latest.current = { openList, showDate, me };
  });
  useEffect(() => {
    const sub = onSidebar((e) => {
      const prefs = usePrefs.getState();
      if (e.type === "date") latest.current.showDate(e.date);
      else if (e.type === "toggle") {
        if (e.id.startsWith("person:")) togglePerson(e.id.slice(7) as PersonKey, latest.current.me);
        else if (e.id.startsWith("cal:")) prefs.toggleCalendar(e.id.slice(4));
        else if (e.id.startsWith("category:")) prefs.toggleCalendar(e.id);
      } else if (e.type === "select") {
        if (e.id.startsWith("category:")) latest.current.openList(e.id.slice(9));
        else if (e.id.startsWith("smart:")) latest.current.openList(e.id);
      }
    });
    return () => sub?.remove();
  }, []);
}

/** A person's tick: whose items show (at least one person always does). */
function togglePerson(key: PersonKey, me: PersonKey): void {
  const prefs = usePrefs.getState();
  const included = peopleForFilter(me, prefs.filter);
  const on = included.includes(key);
  if (on && included.length === 1) return;
  const next = on ? included.filter((k) => k !== key) : [...included, key];
  prefs.setFilter(next.length === 2 ? "both" : next[0] === me ? "me" : "other");
}
