import DateTimePicker from "@react-native-community/datetimepicker";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { isCategory } from "@shared/categories";
import type { CalendarEvent, DateKey, EventOccurrence, EventOverride, Schedule } from "@shared/model";
import { PERSON_KEYS, otherPerson, type PersonKey } from "@shared/people";
import { REPEAT_PRESETS, describeRule, repeatPresetKey } from "@shared/recurrence";
import { SCHEDULE_CALENDAR, hasEndTime } from "@shared/schedules";
import { addDaysKey, deviceTimeZone, diffDaysKey, fieldsInZone, formatHHmm, keyInZone, zonedMs } from "@shared/time";
import { router } from "expo-router";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CategoryValue } from "@/components/ColorSwatches";
import { DestructiveButton, Group, Row, Switch, TextRow, ValueRow } from "@/components/Form";
import { Segmented } from "@/components/Segmented";
import { DetailsBar } from "@/components/SheetHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { WhenRow, useWhenLayout } from "@/components/WhenRows";
import { dateFromKey, keyFromDate } from "@/lib/dates";
import { deleteSchedule, newId, patchEvent, patchSchedule, saveEventLocal, saveSchedule } from "@/lib/db";
import { useMe, usePerson, usePersonColor } from "@/lib/people";
import { useToday, viewerTz } from "@/lib/useNow";
import { useEditZones } from "@/lib/zones";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors, useIsDark } from "@/theme";
import { isMac } from "../../modules/gooya-mac";
import { CategoryMenu } from "@/mac/CategoryMenu";
import type { EditorHost } from "./TaskEditor";

/** A calendar of a connected account whose events can be changed in GOOYA (Two-way, and writable). */
export interface TwoWayCalendar {
  accountId: string;
  calendarId: string;
  name: string;
  color: string;
  source: "google" | "apple";
}

/** The person's two-way calendars: a schedule can be made there instead of in GOOYA. */
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
  /** A schedule to edit: GOOYA's own (drawn as an event, source 'gooya') or an event of a two-way calendar. */
  event?: CalendarEvent;
  /** The occurrence that was opened (a repeating schedule's one day). */
  occ?: EventOccurrence;
  initialOwner?: PersonKey;
  initialDate?: DateKey;
  /** Minutes since midnight for a new schedule's start. */
  initialMinutes?: number;
  initialTitle?: string;
  topBar?: ReactNode;
  onClose: () => void;
  host?: EditorHost;
}

const MIN_MS = 60_000;
const GOOYA = "gooya";

/** A new schedule's start: the given day and time, or the next full hour today. */
function defaultStart(date: DateKey, minutes: number | undefined, today: DateKey): Date {
  if (minutes != null) return new Date(zonedMs(date, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, deviceTimeZone()));
  const d = date === today ? new Date() : new Date(zonedMs(date, "09:00", deviceTimeZone()));
  if (date === today) d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/**
 * Apple Calendar's New Event / Edit Event, for a schedule: GOOYA's own (saved in GOOYA, and copied to the person's
 * Google or iCloud when they have that on), or an event of a two-way Google or iCloud calendar (the server sends the
 * change there within seconds and takes their version back: functions/src/integrations pushGoogleEvent /
 * pushAppleEvent). A schedule of GOOYA's may have no end time ("lunch at noon").
 */
export function ScheduleEditor({ event, occ, initialOwner, initialDate, initialMinutes, initialTitle, topBar, onClose, host }: Props) {
  const popover = host?.variant === "mac";
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const today = useToday();
  const calendars = useTwoWayCalendars();
  const stored = useData((s) => (event?.source === GOOYA ? s.schedules.find((x) => x.id === event.id) : undefined));
  const editing = !!event;
  const ov: EventOverride | undefined = event && occ ? event.overrides?.[occ.dateKey] : undefined;
  const start0 = occ?.start ?? event?.start ?? defaultStart(initialDate ?? today, initialMinutes, today).getTime();
  const end0 = occ?.end ?? event?.end ?? start0 + 3600_000;

  const [title, setTitleState] = useState(occ?.title ?? event?.title ?? initialTitle ?? "");
  const setTitle = (t: string) => {
    setTitleState(t);
    host?.onTitle?.(t);
  };
  const [location, setLocation] = useState(ov?.location ?? event?.location ?? "");
  const [notes, setNotes] = useState(ov?.notes ?? event?.notes ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(() => new Date(start0));
  const [end, setEnd] = useState(() => new Date(end0 > start0 ? end0 : start0 + 3600_000));
  const [hasEnd, setHasEnd] = useState(event ? hasEndTime(event) : true);
  const [startDate, setStartDate] = useState<DateKey>(occ?.startDate ?? event?.startDate ?? initialDate ?? today);
  const [endDate, setEndDate] = useState<DateKey>(occ?.endDate ?? event?.endDate ?? initialDate ?? today);
  const [owner, setOwner] = useState<PersonKey>(event?.owner ?? initialOwner ?? me);
  const [repeatKey, setRepeatKey] = useState(repeatPresetKey(event?.rrule ?? null));
  const [calendarKey, setCalendarKey] = useState(event ? (event.source === GOOYA ? GOOYA : `${event.accountId}/${event.calendarId}`) : GOOYA);
  const [categoryId, setCategoryId] = useState<string | null>(stored?.categoryId ?? null);
  const [ownColor, setOwnColor] = useState<string | null>(stored?.color ?? null);
  const [shared, setShared] = useState(!stored?.private);
  const [busy, setBusy] = useState(false);
  const category = useData((s) => (categoryId ? s.lists.find((l) => l.id === categoryId && isCategory(l)) : undefined));
  const ownerInfo = usePerson(owner);
  const otherName = usePerson(otherPerson(me)).name;
  // The clock the schedule is kept on: its owner's (a schedule made for someone is in their time zone), or an imported
  // event's own.
  const tz = event && (event.source !== GOOYA || owner === event.owner) ? event.timezone || ownerInfo.timezone : ownerInfo.timezone;
  const editZones = useEditZones(owner, start.getTime());
  // Only one's own schedule can be kept to oneself.
  const isPrivate = owner === me && !shared;
  const calendar = calendars.find((c) => `${c.accountId}/${c.calendarId}` === calendarKey);
  const inGooya = calendarKey === GOOYA;
  // Only GOOYA's own schedules may go without an end time: Google and iCloud events always have one.
  const endless = inGooya && !allDay && !hasEnd;
  const ownerColor = usePersonColor(owner);
  // Its own colour, else its category's, else its owner's: as it is drawn.
  const drawnColor = ownColor ?? category?.color ?? ownerColor;
  const setListPicker = usePickers((s) => s.setList);
  const rrule = repeatKey === "custom" ? (event?.rrule ?? null) : (REPEAT_PRESETS.find((p) => p.key === repeatKey)?.rrule ?? null);

  const valid = title.trim().length > 0 && (inGooya || !!calendar) && (allDay ? endDate >= startDate : endless || end.getTime() > start.getTime());

  /** The times as GOOYA keeps them: instants, and days on the schedule's clock. */
  const times = () => {
    if (allDay) return { start: zonedMs(startDate, "00:00", tz), end: zonedMs(addDaysKey(endDate, 1), "00:00", tz), startDate, endDate };
    const s = start.getTime();
    const e = endless ? s : Math.max(end.getTime(), s + 5 * MIN_MS);
    return { start: s, end: e, startDate: keyInZone(s, tz), endDate: keyInZone(Math.max(s, e - 1), tz) };
  };

  /** The whole schedule (all of a repeating one's days): the series moves by as much as this day was moved. */
  const fieldsForAll = (base: Pick<CalendarEvent, "start" | "startDate" | "rrule">) => {
    const t = times();
    if (!occ || !base.rrule) return t;
    const shift = allDay ? diffDaysKey(occ.startDate, t.startDate) : 0;
    const delta = allDay ? 0 : t.start - occ.start;
    const length = allDay ? diffDaysKey(t.startDate, t.endDate) : t.end - t.start;
    const masterStartDate = addDaysKey(base.startDate, shift);
    const s = allDay ? zonedMs(masterStartDate, "00:00", tz) : base.start + delta;
    const e = allDay ? zonedMs(addDaysKey(masterStartDate, length + 1), "00:00", tz) : s + length;
    return { start: s, end: e, startDate: allDay ? masterStartDate : keyInZone(s, tz), endDate: allDay ? addDaysKey(masterStartDate, length) : keyInZone(Math.max(s, e - 1), tz) };
  };

  const saveAll = async (ev: CalendarEvent) => {
    const common = { title: title.trim(), location, notes, allDay, ...fieldsForAll(ev) };
    if (ev.source === GOOYA) await patchSchedule(ev.id, { ...common, owner, rrule, categoryId: category ? categoryId : null, color: ownColor, private: isPrivate });
    else await patchEvent(ev.id, common);
  };

  const saveOne = async (ev: CalendarEvent, o: EventOccurrence) => {
    const t = times();
    const before = ev.overrides?.[o.dateKey] ?? {};
    const next: EventOverride = { ...before, start: t.start, end: t.end };
    if (title.trim() !== ev.title) next.title = title.trim();
    if (notes !== ev.notes) next.notes = notes;
    if (location !== ev.location) next.location = location;
    const overrides = { ...(ev.overrides ?? {}), [o.dateKey]: next };
    if (ev.source === GOOYA) await patchSchedule(ev.id, { overrides });
    else await patchEvent(ev.id, { overrides });
  };

  const save = async () => {
    if (!valid || busy) return;
    const repeating = !!(event && occ && event.rrule);
    if (repeating && event && occ) {
      // Apple's question for a repeating schedule. Switching all-day, the repeat or the person is for all of them.
      const allOnly = allDay !== event.allDay || rrule !== event.rrule || owner !== event.owner || (stored?.categoryId ?? null) !== categoryId || (stored?.color ?? null) !== ownColor || !!stored?.private !== isPrivate;
      const options = allOnly ? ["Save for All Events", "Cancel"] : ["Save for This Event Only", "Save for All Events", "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions({ title: "This is a repeating schedule.", options, cancelButtonIndex: options.length - 1 }, (i) => {
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
      else if (inGooya) {
        const now = Date.now();
        const schedule: Schedule = {
          id: newId(),
          owner,
          createdBy: me,
          title: title.trim(),
          notes,
          location,
          allDay,
          ...times(),
          timezone: tz,
          rrule,
          exdates: [],
          overrides: {},
          categoryId: category ? categoryId : null,
          color: ownColor,
          private: isPrivate,
          createdAt: now,
          updatedAt: now,
        };
        await saveSchedule(schedule);
      } else if (calendar) {
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
          ...times(),
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

  // The popover's host saves on Return and when clicked away (nothing to save with no title, nor when nothing changed).
  const snapshot = () => JSON.stringify([title, location, notes, allDay, start.getTime(), end.getTime(), hasEnd, startDate, endDate, owner, repeatKey, calendarKey, categoryId, ownColor, shared]);
  const opened = useRef<string | null>(null);
  if (opened.current === null) opened.current = snapshot();
  const register = host?.register;
  useLayoutEffect(() => {
    if (!register) return;
    register(async () => {
      if (!valid) return false;
      if (event && snapshot() === opened.current) {
        onClose();
        return true;
      }
      await save();
      return true;
    });
  });

  const remove = () => {
    if (!event) return;
    const gooya = event.source === GOOYA;
    const deleteAll = () => void (gooya ? deleteSchedule(event.id) : patchEvent(event.id, { deleted: true })).then(onClose);
    if (occ && event.rrule) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: "This is a repeating schedule.", options: ["Delete This Event Only", "Delete All Events", "Cancel"], destructiveButtonIndex: [0, 1], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) {
            const overrides = { ...(event.overrides ?? {}) };
            delete overrides[occ.dateKey];
            const patch = { exdates: [...new Set([...(event.exdates ?? []), occ.dateKey])], overrides };
            void (gooya ? patchSchedule(event.id, patch) : patchEvent(event.id, patch)).then(onClose);
          } else if (i === 1) deleteAll();
        },
      );
      return;
    }
    Alert.alert("Delete Schedule", gooya ? "It is deleted from the GOOYA calendar in Google and iCloud too, if it is copied there." : `It is deleted from ${event.source === "google" ? "Google Calendar" : "iCloud"} too.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Schedule", style: "destructive", onPress: deleteAll },
    ]);
  };

  const when = useWhenLayout();
  // A day's pickers (all-day) are on this phone's calendar; a time's on the clock of their zone.
  const picker = (mode: "date" | "time", value: Date, zone: string | undefined, onChange: (d: Date) => void, min?: Date) => (
    <DateTimePicker value={value} minimumDate={min} mode={mode} display="compact" minuteInterval={5} timeZoneName={zone} themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(d)} />
  );
  const setStartKeepingLength = (d: Date) => {
    const length = end.getTime() - start.getTime();
    setStart(d);
    setEnd(new Date(d.getTime() + Math.max(length, 5 * MIN_MS)));
  };
  const clockIn = (d: Date, zone: string) => {
    const f = fieldsInZone(d.getTime(), zone);
    return formatHHmm(f.h, f.min);
  };
  /** The day picked on a zone's calendar, at the time `was` had on that clock. */
  const withDay = (was: Date, picked: Date, zone: string) => new Date(zonedMs(keyInZone(picked.getTime(), zone), clockIn(was, zone), zone));
  /** The time picked on a zone's clock, on the day `was` had there. */
  const withTime = (was: Date, picked: Date, zone: string) => new Date(zonedMs(keyInZone(was.getTime(), zone), clockIn(picked, zone), zone));
  // GOOYA's own schedule is shown on its owner's clock and, when it reads differently, on this phone's too; an imported
  // event on this phone's.
  const zones = inGooya ? editZones : [{ zone: viewerTz, label: "" }];
  const dual = zones.length > 1;
  const timedRows = (zone: string, withEndSwitch: boolean) => [
    <WhenRow key="s" layout={when} label="Starts" date={picker("date", start, zone, (d) => setStartKeepingLength(withDay(start, d, zone)))} time={picker("time", start, zone, (d) => setStartKeepingLength(withTime(start, d, zone)))} />,
    withEndSwitch && inGooya ? (
      <Row key="e" label="End Time">
        <Switch label="End time" value={hasEnd} onChange={setHasEnd} />
      </Row>
    ) : null,
    !endless ? <WhenRow key="t" layout={when} label="Ends" date={picker("date", end, zone, (d) => setEnd(withDay(end, d, zone)), start)} time={picker("time", end, zone, (d) => setEnd(withTime(end, d, zone)))} /> : null,
  ];
  const people = PERSON_KEYS.map((k) => ({ value: k, label: k === "gooya" ? "구야" : "은비" }));
  const places = [{ key: GOOYA, name: SCHEDULE_CALENDAR }, ...calendars.map((c) => ({ key: `${c.accountId}/${c.calendarId}`, name: c.name }))];
  const shown = inGooya
    ? { name: SCHEDULE_CALENDAR, color: drawnColor, source: GOOYA as CalendarEvent["source"] }
    : (calendar ?? (event ? { name: event.calendarName, color: event.color, source: event.source } : null));
  const where = inGooya ? null : shown?.source === "google" ? "Google Calendar" : "iCloud";

  return (
    <View style={popover ? styles.popover : [styles.fill, { backgroundColor: colors.bg2 }]}>
      {popover ? null : <DetailsBar title={editing ? "Edit Schedule" : "New Schedule"} onCancel={onClose} onDone={() => void save()} doneLabel={editing ? "Done" : "Add"} doneDisabled={!valid || busy} />}
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={popover ? styles.popoverContent : styles.content} showsVerticalScrollIndicator={false} style={popover ? styles.popoverScroll : undefined}>
        {topBar}
        <Group>
          <TextRow value={title} onChange={setTitle} placeholder={popover && !editing ? "New Schedule" : "Title"} autoFocus={!editing} onSubmitEditing={popover ? () => void save() : undefined} />
          <TextRow value={location} onChange={setLocation} placeholder="Location" />
        </Group>

        {inGooya ? (
          <Group>
            <Row label="For">
              <Segmented<PersonKey> options={people} value={owner} onChange={setOwner} style={{ width: 170 }} />
            </Row>
          </Group>
        ) : null}

        {/* Each row its own child, so the group draws the lines between them. */}
        <Group header={dual && !allDay ? zones[0].label : undefined} footer={endless ? "No end time: it is at its start time." : undefined}>
          <Row label="All-day">
            <Switch label="All-day" value={allDay} onChange={setAllDay} />
          </Row>
          {allDay ? (
            <WhenRow
              layout={when}
              label="Starts"
              date={picker("date", dateFromKey(startDate), undefined, (d) => {
                const k = keyFromDate(d);
                setEndDate(addDaysKey(k, Math.max(0, diffDaysKey(startDate, endDate))));
                setStartDate(k);
              })}
            />
          ) : null}
          {allDay ? <WhenRow layout={when} label="Ends" date={picker("date", dateFromKey(endDate), undefined, (d) => setEndDate(keyFromDate(d)), dateFromKey(startDate))} /> : null}
          {!allDay ? timedRows(zones[0].zone, true) : null}
        </Group>
        {dual && !allDay ? (
          <Group header={zones[1].label} footer="The same moment on both clocks: change either one and the other follows.">
            {timedRows(zones[1].zone, false)}
          </Group>
        ) : null}

        <Group footer={where ? `Changes go to ${where} as you save them.` : "Copied to the GOOYA calendar in your Google or iCloud when that is on (Settings → Calendar integrations)."}>
          {inGooya ? (
            <ValueRow icon="repeat" label="Repeat" value={repeatKey === "custom" ? describeRule(rrule) : (REPEAT_PRESETS.find((p) => p.key === repeatKey)?.label ?? "Never")} options={REPEAT_PRESETS.map((p) => p.label)} title="Repeat" onPick={(_, i) => setRepeatKey(REPEAT_PRESETS[i].key)} />
          ) : event?.rrule ? (
            <Row label="Repeat">
              <Text style={[styles.value, { color: colors.label2 }]}>{describeRule(event.rrule)}</Text>
            </Row>
          ) : null}
          {editing || !calendars.length ? (
            <Row label="Calendar">
              <View style={styles.inline}>
                <View style={[styles.dot, { backgroundColor: shown?.color ?? colors.blue }]} />
                <Text numberOfLines={1} style={[styles.value, { color: colors.label2 }]}>
                  {shown?.name}
                </Text>
                {shown ? <SourceBadge source={shown.source} size={14} color={colors.label2} /> : null}
              </View>
            </Row>
          ) : (
            <ValueRow label="Calendar" value={places.find((p) => p.key === calendarKey)?.name ?? SCHEDULE_CALENDAR} options={places.map((p) => p.name)} onPick={(_, i) => setCalendarKey(places[i].key)} />
          )}
          {inGooya && popover ? (
            <Row label="Category">
              <CategoryMenu value={category ? categoryId : null} name={category?.name ?? "None"} color={category?.color ?? null} onPick={setCategoryId} allowNone />
            </Row>
          ) : inGooya ? (
            <Row
              label="Category"
              accessibilityLabel="Category"
              chevron
              onPress={() => {
                setListPicker({ value: category ? categoryId : null, onPick: setCategoryId, allowNone: true });
                router.push("/sheet/list");
              }}
            >
              <CategoryValue name={category?.name ?? "None"} color={category?.color ?? null} dim={!category} />
            </Row>
          ) : null}
          {inGooya ? (
            <Row label="Color" accessibilityLabel="Color">
              {ownColor ? (
                <Pressable accessibilityRole="button" onPress={() => setOwnColor(null)} hitSlop={8}>
                  <Text style={[styles.reset, { color: colors.blue }]}>{category ? "Use Category’s" : `Use ${ownerInfo.name}’s`}</Text>
                </Pressable>
              ) : (
                <Text numberOfLines={1} style={[styles.value, { color: colors.label2 }]}>
                  {category ? category.name : `${ownerInfo.name}’s`}
                </Text>
              )}
              <View style={styles.colorWell}>
                <Host matchContents>
                  <ColorPicker selection={drawnColor} supportsOpacity={false} onSelectionChange={(c) => setOwnColor(c.slice(0, 7).toLowerCase())} />
                </Host>
              </View>
            </Row>
          ) : null}
        </Group>

        <Group>
          <TextRow value={notes} onChange={setNotes} placeholder="Notes" multiline />
        </Group>

        {inGooya && owner === me ? (
          <Group footer={shared ? `${otherName} sees it too.` : `Only you see it: not on ${otherName}’s calendar or widget. A copy in your own Google or iCloud calendar stays yours.`}>
            <Row label={`Share with ${otherName}`}>
              <Switch label={`Share with ${otherName}`} value={shared} onChange={setShared} />
            </Row>
          </Group>
        ) : null}

        {editing && (event?.source !== GOOYA || stored) ? <DestructiveButton onPress={remove}>Delete Schedule</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 20, paddingBottom: 60, paddingTop: 4 },
  popover: { flexShrink: 1 },
  popoverScroll: { flexGrow: 0 },
  popoverContent: { gap: 12, paddingTop: 10, paddingBottom: 12 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  value: { fontSize: isMac ? 13 : 17, flexShrink: 1 },
  reset: { fontSize: isMac ? 13 : 17 },
  colorWell: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
