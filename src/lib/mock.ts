// In-memory demo data so the app can be exercised without Firebase (the iPhone Simulator has no Google account).
// EXPO_PUBLIC_DEMO=1 (optionally EXPO_PUBLIC_DEMO_ME=eunbi). Demo mode never reads or writes Firestore.
import type { CalendarEvent, Routine, Schedule, Task, TaskList, UserDoc } from "@shared/model";
import { PEOPLE, type PersonKey } from "@shared/people";
import { addDaysKey, deviceTimeZone, todayKey, zonedMs } from "@shared/time";
import { useData } from "@/store/data";
import { env } from "./env";

export const isMock = env.demo;
export const mockMe: PersonKey = env.demoMe;

let seq = 0;
const id = () => `mock-${++seq}`;

function task(owner: PersonKey, title: string, dueDate: string | null, dueTime: string | null, extra: Partial<Task> = {}): Task {
  return {
    id: id(), owner, createdBy: owner, listId: "tasks", title, notes: "", dueDate, dueTime, timezone: PEOPLE[owner].timezone,
    rrule: null, exdates: [], overrides: {}, completed: false, completedDates: [], earlyReminders: [], tags: [], flagged: false,
    priority: 0, source: "gooya", externalRefs: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  };
}

function routine(owner: PersonKey, title: string, icon: string, kind: Routine["kind"], startTime: string, endTime: string, rrule: string): Routine {
  return {
    id: id(), owner, title, icon, kind, color: null, startTime, endTime, timezone: PEOPLE[owner].timezone,
    rrule, startDate: "2026-01-01", endDate: null, exdates: [], overrides: {}, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function startMockData(): void {
  const tz = deviceTimeZone();
  const today = todayKey(tz);
  const d = (n: number) => addDaysKey(today, n);

  const tasks: Task[] = [
    task("gooya", "Gym", d(0), "07:00", { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", completedDates: [d(-2)], earlyReminders: [15] }),
    task("gooya", "CS6750 lecture", d(1), "10:00", { rrule: "FREQ=WEEKLY;BYDAY=TU,TH", notes: "Klaus 1443", tags: ["school"] }),
    task("gooya", "Dentist", d(2), "14:00", { notes: "Midtown Dental\nhttps://midtowndental.example", earlyReminders: [60], priority: 2 }),
    task("gooya", "Call 은비", d(0), "21:00", { rrule: "FREQ=DAILY", flagged: true }),
    task("gooya", "Labcorp", d(-11), "08:30", { completed: true }),
    task("gooya", "Rent due", d(4), null, { rrule: "FREQ=MONTHLY", priority: 3, listId: "home" }),
    task("gooya", "Flight to Seoul", d(13), null, { notes: "ATL → ICN", listId: "trip", tags: ["trip"] }),
    task("gooya", "Homework: HW3", d(3), null, { createdBy: "eunbi", tags: ["school"] }),
    task("eunbi", "Korean class", d(1), "19:00", { rrule: "FREQ=WEEKLY;BYDAY=TU,TH" }),
    task("eunbi", "Team standup", d(0), "10:00", { rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }),
    task("eunbi", "Dinner with 지수", d(5), "18:30", { notes: "성수동" }),
    task("eunbi", "엄마 생신", d(9), null, { flagged: true }),
    task("eunbi", "Vacation", d(20), null, { listId: "trip" }),
    task("eunbi", "Yoga", d(0), "07:30", { rrule: "FREQ=WEEKLY;BYDAY=SA,SU" }),
    task("gooya", "Pick up package", d(0), "12:00"),
    task("gooya", "Read chapter 4", d(0), "16:00", { listId: "home" }),
    task("gooya", "Laundry", d(0), "18:00", { listId: "home" }),
    task("eunbi", "Groceries", d(0), "12:00", { createdBy: "gooya", listId: "home", tags: ["errand"] }),
    task("gooya", "Someday: learn Korean cooking", null, null, { listId: "home" }),
  ];

  const routines: Routine[] = [
    routine("gooya", "Work", "💼", "work", "09:00", "17:00", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
    routine("gooya", "Sleep", "💤", "sleep", "23:30", "07:00", "FREQ=DAILY"),
    routine("eunbi", "Work", "💼", "work", "09:00", "18:00", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
    routine("eunbi", "Sleep", "💤", "sleep", "00:30", "08:00", "FREQ=DAILY"),
  ];

  const users: Partial<Record<PersonKey, UserDoc>> = {
    gooya: { key: "gooya", email: PEOPLE.gooya.email, name: "구야", timezone: PEOPLE.gooya.timezone, color: "#0091ff", fcmTokens: [], settings: {} },
    eunbi: { key: "eunbi", email: PEOPLE.eunbi.email, name: "은비", timezone: PEOPLE.eunbi.timezone, color: "#ff9230", fcmTokens: [], settings: {} },
  };

  const lists: TaskList[] = [
    { id: "tasks", name: "Tasks", color: "#0091ff", icon: "list", order: 0, createdBy: "gooya", createdAt: 0, updatedAt: 0 },
    { id: "home", name: "Home", color: "#30d158", icon: "house", order: 1, createdBy: "gooya", createdAt: 0, updatedAt: 0 },
    { id: "trip", name: "Trip", color: "#ff9230", icon: "airplane", order: 2, createdBy: "eunbi", createdAt: 0, updatedAt: 0 },
  ];

  const ev = (owner: PersonKey, source: "google" | "apple", title: string, date: string, start: string | null, end: string | null, extra: Partial<CalendarEvent> = {}): CalendarEvent => {
    const tz2 = PEOPLE[owner].timezone;
    const allDay = !start;
    const s = allDay ? zonedMs(date, "00:00", tz2) : zonedMs(date, start!, tz2);
    const e = allDay ? zonedMs(addDaysKey(date, 1), "00:00", tz2) : zonedMs(date, end!, tz2);
    return {
      id: id(), owner, source, accountId: source === "google" ? "g_demo" : "a_demo", calendarId: "cal", calendarName: source === "google" ? "Work" : "Family", externalId: id(), iCalUID: `${title}@demo`,
      title, notes: "", location: "", allDay, start: s, end: e, startDate: date, endDate: date, timezone: tz2, rrule: null, exdates: [], overrides: {},
      color: source === "google" ? "#3f51b5" : "#ff9230", editable: source === "google", etag: "1", updatedAt: Date.now(), ...extra,
    };
  };
  const events: CalendarEvent[] = [
    // Weekly on today's weekday, so the sample calendar always has an event today.
    ev("gooya", "google", "Design review", d(0), "13:00", "14:00", { rrule: `FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(`${d(0)}T12:00:00Z`).getUTCDay()]}`, location: "Zoom" }),
    ev("gooya", "google", "Design review", d(0), "13:00", "14:00", { source: "apple", accountId: "a_demo", calendarName: "Family", color: "#ff9230", editable: false }),
    ev("gooya", "apple", "추석", d(3), null, null, { iCalUID: "chuseok@demo" }),
    ev("eunbi", "google", "1:1 with manager", d(1), "15:00", "15:30", { iCalUID: "one@demo" }),
    // An invitation from Gmail with a Google Meet call, as Google Calendar sends it.
    ev("gooya", "google", "AVENA AI Weekly Review", d(0), "09:00", "09:30", {
      iCalUID: "avena@demo",
      calendarName: "goochoi913@gmail.com",
      color: "#9fdde3",
      editable: false,
      notes: "Weekly review of the AVENA AI project.\nAgenda: https://docs.google.com/document/d/avena-agenda",
      attendees: [
        { email: "firman@asterakb.com", status: "accepted", organizer: true },
        { email: "goochoi913@gmail.com", status: "needsAction", self: true },
        { email: "adriana@asterakb.com", status: "accepted" },
        { email: "estimating@theavena.com", status: "needsAction" },
        { email: "ivy@theavena.com", name: "Ivy Tran", status: "tentative" },
        { email: "lam@theavena.com", status: "declined" },
        { email: "maya@asterakb.com", status: "needsAction" },
        { email: "rahmat@homestyle.co.id", status: "needsAction" },
        { email: "sisca@asterakb.com", status: "needsAction" },
        { email: "vtina@asterakb.com", status: "needsAction", optional: true },
      ],
      attendeeCount: 10,
      organizer: { email: "firman@asterakb.com" },
      myStatus: "needsAction",
      conference: { name: "Google Meet", url: "https://meet.google.com/jke-jwff-ahm", phones: ["tel:+1-470-268-2442,,187432954#"], details: "PIN: 187 432 954#" },
      showAs: "free",
      alerts: [30],
      htmlLink: "https://www.google.com/calendar/event?eid=demo",
    }),
    // A Zoom meeting whose link is only in the location, as university calendars send them.
    ev("gooya", "apple", "Superforecasting Reading Group [CS6750]", d(0), "20:30", "21:30", {
      iCalUID: "zoom@demo",
      calendarName: "GT Calendar (Canvas)",
      color: "#65c466",
      location: "https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1",
      notes: "Join Zoom Meeting\nhttps://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1\n\nhttps://gatech.instructure.com/calendar?include_contexts=course_536416",
    }),
  ];
  const schedule = (owner: PersonKey, title: string, date: string, start: string | null, end: string | null, extra: Partial<Schedule> = {}): Schedule => {
    const tz2 = PEOPLE[owner].timezone;
    const allDay = !start;
    const s = allDay ? zonedMs(date, "00:00", tz2) : zonedMs(date, start!, tz2);
    const e = allDay ? zonedMs(addDaysKey(date, 1), "00:00", tz2) : end ? zonedMs(date, end, tz2) : s;
    return { id: id(), owner, createdBy: owner, title, notes: "", location: "", allDay, start: s, end: e, startDate: date, endDate: date, timezone: tz2, rrule: null, exdates: [], overrides: {}, createdAt: 0, updatedAt: 0, ...extra };
  };
  const schedules: Schedule[] = [
    schedule("gooya", "Lunch with Minho", d(0), "12:30", "13:30", { location: "Ponce City Market" }),
    schedule("eunbi", "Dentist", d(1), "15:00", "16:00"),
    schedule("gooya", "Pick up 은비 at the airport", d(2), "18:45", null),
    schedule("eunbi", "Family dinner", d(5), "19:00", "21:00", { createdBy: "gooya" }),
  ];
  const { setTasks, setSchedules, setRoutines, setUsers, setLists, setEvents, setAccounts } = useData.getState();
  setTasks(tasks);
  setSchedules(schedules);
  setRoutines(routines);
  setUsers(users);
  setLists(lists);
  setEvents(events);
  setAccounts([
    { id: "g_demo", source: "google", email: "goochoi913@gmail.com", status: "connected", lastSync: Date.now() - 120_000, exportTasks: true, exportSchedules: true, calendars: { primary: { name: "goochoi913@gmail.com", color: "#3f51b5", primary: true, direction: "both" }, work: { name: "Work", color: "#3f51b5", direction: "import" } } },
    { id: "a_demo", source: "apple", email: "goo@icloud.com", status: "connected", lastSync: Date.now() - 300_000, calendars: { family: { name: "Family", color: "#ff9230", direction: "import" }, home: { name: "Home", color: "#30d158", direction: "off" } } },
  ]);
}
