import DateTimePicker from "@react-native-community/datetimepicker";
import type { CalendarEvent, DateKey, EventOccurrence, EventOverride } from "@shared/model";
import { addDaysKey, deviceTimeZone, diffDaysKey, keyInZone, zonedMs } from "@shared/time";
import { useMemo, useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { DestructiveButton, Group, Row, Switch, TextRow, ValueRow } from "@/components/Form";
import { DetailsBar } from "@/components/SheetHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { dateFromKey, keyFromDate } from "@/lib/dates";
import { newId, patchEvent, saveEventLocal } from "@/lib/db";
import { useMe } from "@/lib/people";
import { useToday } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useColors, useIsDark } from "@/theme";

/** A calendar of a connected account whose events can be changed in GOOYA (Two-way, and writable). */
export interface TwoWayCalendar {
  accountId: string;
  calendarId: string;
  name: string;
  color: string;
  source: "google" | "apple";
}

/** The person's two-way calendars, for making events in GOOYA. */
export function useTwoWayCalendars(): TwoWayCalendar[] {
  const accounts = useData((s) => s.accounts);
  return useMemo(
    () =>
      accounts.flatMap((a) =>
        Object.entries(a.calendars ?? {})
          .filter(([, c]) => c.direction === "both" && c.writable !== false)
          .sort((x, y) => Number(!!y[1].primary) - Number(!!x[1].primary) || x[1].name.localeCompare(y[1].name))
          .map(([calendarId, c]) => ({ accountId: a.id, calendarId, name: c.name, color: c.color, source: a.source })),
      ),
    [accounts],
  );
}

interface Props {
  event?: CalendarEvent;
  /** The occurrence that was opened (a repeating event's one day). */
  occ?: EventOccurrence;
  initialDate?: DateKey;
  /** Minutes since midnight for a new event's start. */
  initialMinutes?: number;
  topBar?: ReactNode;
  onClose: () => void;
}

const MIN_MS = 60_000;

/** A new event's start: the given day and time, or the next full hour today. */
function defaultStart(date: DateKey, minutes: number | undefined, today: DateKey): Date {
  if (minutes != null) return new Date(zonedMs(date, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, deviceTimeZone()));
  const d = date === today ? new Date() : new Date(zonedMs(date, "09:00", deviceTimeZone()));
  if (date === today) d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/**
 * Apple Calendar's New Event / Edit Event for an event of a two-way Google or iCloud calendar. Saving writes the
 * change to GOOYA at once (marked dirty); the server sends it to Google or iCloud within seconds and takes their
 * version back (functions/src/integrations: pushGoogleEvent / pushAppleEvent).
 */
export function EventEditor({ event, occ, initialDate, initialMinutes, topBar, onClose }: Props) {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const today = useToday();
  const calendars = useTwoWayCalendars();
  const editing = !!event;
  const tz = event?.timezone || deviceTimeZone();
  const ov: EventOverride | undefined = event && occ ? event.overrides?.[occ.dateKey] : undefined;
  const start0 = occ?.start ?? event?.start ?? defaultStart(initialDate ?? today, initialMinutes, today).getTime();
  const end0 = occ?.end ?? event?.end ?? start0 + 3600_000;

  const [title, setTitle] = useState(occ?.title ?? event?.title ?? "");
  const [location, setLocation] = useState(ov?.location ?? event?.location ?? "");
  const [notes, setNotes] = useState(ov?.notes ?? event?.notes ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(() => new Date(start0));
  const [end, setEnd] = useState(() => new Date(end0));
  const [startDate, setStartDate] = useState<DateKey>(occ?.startDate ?? event?.startDate ?? initialDate ?? today);
  const [endDate, setEndDate] = useState<DateKey>(occ?.endDate ?? event?.endDate ?? initialDate ?? today);
  const [calendarKey, setCalendarKey] = useState(event ? `${event.accountId}/${event.calendarId}` : calendars[0] ? `${calendars[0].accountId}/${calendars[0].calendarId}` : "");
  const [busy, setBusy] = useState(false);
  const calendar = calendars.find((c) => `${c.accountId}/${c.calendarId}` === calendarKey);

  const valid = title.trim().length > 0 && (editing || !!calendar) && (allDay ? endDate >= startDate : end.getTime() > start.getTime());

  /** The times as GOOYA keeps them: instants, and days on the event's clock. */
  const times = () => {
    if (allDay) return { start: zonedMs(startDate, "00:00", tz), end: zonedMs(addDaysKey(endDate, 1), "00:00", tz), startDate, endDate };
    const s = start.getTime();
    const e = Math.max(end.getTime(), s + 5 * MIN_MS);
    return { start: s, end: e, startDate: keyInZone(s, tz), endDate: keyInZone(Math.max(s, e - 1), tz) };
  };

  const saveAll = async (ev: CalendarEvent) => {
    const t = times();
    if (!occ || !ev.rrule) {
      await patchEvent(ev.id, { title: title.trim(), location, notes, allDay, ...t });
      return;
    }
    // All events: the series moves by as much as this occurrence was moved, and takes its length.
    const shift = allDay ? diffDaysKey(occ.startDate, t.startDate) : 0;
    const delta = allDay ? 0 : t.start - occ.start;
    const length = allDay ? diffDaysKey(t.startDate, t.endDate) : t.end - t.start;
    const masterStartDate = addDaysKey(ev.startDate, shift);
    const s = allDay ? zonedMs(masterStartDate, "00:00", tz) : ev.start + delta;
    const e = allDay ? zonedMs(addDaysKey(masterStartDate, length + 1), "00:00", tz) : s + length;
    await patchEvent(ev.id, {
      title: title.trim(),
      location,
      notes,
      allDay,
      start: s,
      end: e,
      startDate: allDay ? masterStartDate : keyInZone(s, tz),
      endDate: allDay ? addDaysKey(masterStartDate, length) : keyInZone(Math.max(s, e - 1), tz),
    });
  };

  const saveOne = async (ev: CalendarEvent, o: EventOccurrence) => {
    const t = times();
    const before = ev.overrides?.[o.dateKey] ?? {};
    const next: EventOverride = { ...before, start: t.start, end: t.end };
    if (title.trim() !== ev.title) next.title = title.trim();
    if (notes !== ev.notes) next.notes = notes;
    if (location !== ev.location) next.location = location;
    await patchEvent(ev.id, { overrides: { ...(ev.overrides ?? {}), [o.dateKey]: next } });
  };

  const save = async () => {
    if (!valid || busy) return;
    if (event && occ && event.rrule) {
      // Apple's question for a repeating event. A switch between all-day and timed can only be for all of them.
      const options = allDay !== event.allDay ? ["Save for All Events", "Cancel"] : ["Save for This Event Only", "Save for All Events", "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions({ title: "This is a repeating event.", options, cancelButtonIndex: options.length - 1 }, (i) => {
        const label = options[i];
        if (label === "Cancel") return;
        setBusy(true);
        void (label === "Save for This Event Only" ? saveOne(event, occ) : saveAll(event)).then(onClose).finally(() => setBusy(false));
      });
      return;
    }
    setBusy(true);
    try {
      if (event) await saveAll(event);
      else if (calendar) {
        const t = times();
        await saveEventLocal({
          id: `new_${newId()}`,
          owner: me,
          source: calendar.source,
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
          calendarName: calendar.name,
          externalId: "",
          iCalUID: "",
          title: title.trim(),
          notes,
          location,
          allDay,
          ...t,
          timezone: tz,
          rrule: null,
          exdates: [],
          overrides: {},
          color: calendar.color,
          editable: true,
          etag: "",
          updatedAt: Date.now(),
          dirty: true,
          deleted: false,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!event) return;
    if (occ && event.rrule) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: "This is a repeating event.", options: ["Delete This Event Only", "Delete All Events", "Cancel"], destructiveButtonIndex: [0, 1], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) {
            const overrides = { ...(event.overrides ?? {}) };
            delete overrides[occ.dateKey];
            void patchEvent(event.id, { exdates: [...new Set([...(event.exdates ?? []), occ.dateKey])], overrides }).then(onClose);
          } else if (i === 1) void patchEvent(event.id, { deleted: true }).then(onClose);
        },
      );
      return;
    }
    Alert.alert("Delete Event", `It is deleted from ${event.source === "google" ? "Google Calendar" : "iCloud"} too.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Event", style: "destructive", onPress: () => void patchEvent(event.id, { deleted: true }).then(onClose) },
    ]);
  };

  const picker = (mode: "date" | "time", value: Date, onChange: (d: Date) => void, min?: Date) => (
    <DateTimePicker value={value} minimumDate={min} mode={mode} display="compact" minuteInterval={5} themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(d)} />
  );
  const setStartKeepingLength = (d: Date) => {
    const length = end.getTime() - start.getTime();
    setStart(d);
    setEnd(new Date(d.getTime() + Math.max(length, 5 * MIN_MS)));
  };
  const withDay = (d: Date, day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), d.getHours(), d.getMinutes(), 0, 0);
  const current = calendar ?? (event ? { name: event.calendarName, color: event.color, source: event.source } : null);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={editing ? "Edit Event" : "New Event"} onCancel={onClose} onDone={() => void save()} doneLabel={editing ? "Done" : "Add"} doneDisabled={!valid || busy} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topBar}
        {!editing && !calendars.length ? (
          <Text style={[styles.note, { color: colors.label2 }]}>Events are made in a Google or iCloud calendar set to Two-way. Choose one in Settings → Calendar integrations.</Text>
        ) : null}
        <Group>
          <TextRow value={title} onChange={setTitle} placeholder="Title" autoFocus={!editing} />
          <TextRow value={location} onChange={setLocation} placeholder="Location" />
        </Group>

        <Group>
          <Row label="All-day">
            <Switch label="All-day" value={allDay} onChange={setAllDay} />
          </Row>
          {allDay ? (
            <>
              <Row label="Starts">{picker("date", dateFromKey(startDate), (d) => {
                const k = keyFromDate(d);
                setEndDate(addDaysKey(k, Math.max(0, diffDaysKey(startDate, endDate))));
                setStartDate(k);
              })}</Row>
              <Row label="Ends">{picker("date", dateFromKey(endDate), (d) => setEndDate(keyFromDate(d)), dateFromKey(startDate))}</Row>
            </>
          ) : (
            <>
              <Row label="Starts">
                {picker("date", start, (d) => setStartKeepingLength(withDay(start, d)))}
                {picker("time", start, setStartKeepingLength)}
              </Row>
              <Row label="Ends">
                {picker("date", end, (d) => setEnd(withDay(end, d)), start)}
                {picker("time", end, (d) => setEnd(withDay(d, end)))}
              </Row>
            </>
          )}
        </Group>

        <Group footer={editing ? `Changes go to ${current?.source === "google" ? "Google Calendar" : "iCloud"} as you save them.` : undefined}>
          {editing ? (
            <Row label="Calendar">
              <View style={styles.inline}>
                <View style={[styles.dot, { backgroundColor: current?.color ?? colors.blue }]} />
                <Text numberOfLines={1} style={[styles.value, { color: colors.label2 }]}>
                  {current?.name}
                </Text>
                {current ? <SourceBadge source={current.source} size={14} color={colors.label2} /> : null}
              </View>
            </Row>
          ) : calendars.length ? (
            <ValueRow
              label="Calendar"
              value={calendar?.name ?? ""}
              options={calendars.map((c) => c.name)}
              onPick={(_, i) => setCalendarKey(`${calendars[i].accountId}/${calendars[i].calendarId}`)}
            />
          ) : null}
        </Group>

        <Group>
          <TextRow value={notes} onChange={setNotes} placeholder="Notes" multiline />
        </Group>

        {editing ? <DestructiveButton onPress={remove}>Delete Event</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 20, paddingBottom: 60, paddingTop: 4 },
  note: { paddingHorizontal: 32, fontSize: 15, lineHeight: 20 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  value: { fontSize: 17, flexShrink: 1 },
});
