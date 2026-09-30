import DateTimePicker from "@react-native-community/datetimepicker";
import { DEFAULT_LIST_ID, type DateKey, type HHmm, type Priority, type Task, type TaskOccurrence } from "@shared/model";
import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { REPEAT_PRESETS, buildRuleBody, describeRule, parseRuleFields, repeatPresetKey } from "@shared/recurrence";
import { isReminderList } from "@shared/reminders";
import { addDaysKey, formatHHmm, parseHHmm, parseKey, weekdayOfKey } from "@shared/time";
import { router } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ActionSheetIOS, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DayToggles, DestructiveButton, Group, Row, SectionTitle, Switch, ValueRow, pickOption } from "@/components/Form";
import { ListBadge } from "@/components/ListIcons";
import { Segmented } from "@/components/Segmented";
import { DetailsBar } from "@/components/SheetHeader";
import { EARLY_REMINDERS, earlyReminderLabel } from "@/lib/alerts";
import { WEEKDAY_SHORT, formatHM, formatMediumDate } from "@/lib/format";
import { dateFromHHmm, dateFromKey, hhmmFromDate, keyFromDate } from "@/lib/dates";
import { useMe, usePerson } from "@/lib/people";
import { applyTaskEdit, createTask, deleteTaskScope, type EditScope, type TaskFields } from "@/lib/taskOps";
import { useToday, viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { usePickers } from "@/store/pickers";
import { useColors, useIsDark } from "@/theme";

interface Props {
  task?: Task;
  occ?: TaskOccurrence;
  initialOwner?: PersonKey;
  initialDate?: DateKey;
  initialMinutes?: number;
  initialListId?: string;
  /** Rendered above the form (the Task | Routine switch). */
  topBar?: ReactNode;
  onClose: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
];
const FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
const FREQ_LABELS = ["Daily", "Weekly", "Monthly", "Yearly"];
const UNITS = ["minutes", "hours", "days"] as const;

const roundTo5 = (min: number): number => Math.min(23 * 60 + 55, Math.max(0, Math.round(min / 5) * 5));

/** "Today", "Tomorrow" or "Wed, Sep 30" */
function describeDate(key: DateKey, today: DateKey): string {
  if (key === today) return "Today";
  if (key === addDaysKey(today, 1)) return "Tomorrow";
  if (key === addDaysKey(today, -1)) return "Yesterday";
  const { y } = parseKey(key);
  return `${WEEKDAY_SHORT[weekdayOfKey(key)]}, ${formatMediumDate(key, y !== Number(today.slice(0, 4)))}`;
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

/** Notes with URLs turned into tappable links. */
export function LinkifiedNotes({ text, color, linkColor }: { text: string; color: string; linkColor: string }) {
  const parts = text.split(URL_RE);
  return (
    <Text style={{ fontSize: 15, lineHeight: 20, color }}>
      {parts.map((part, i) =>
        /^(https?:\/\/|www\.)/i.test(part) ? (
          <Text key={i} style={{ color: linkColor, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(part.startsWith("http") ? part : `https://${part}`)}>
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

/** Reminders-style "Details" sheet for creating or editing a task. */
export function TaskEditor({ task, occ, initialOwner, initialDate, initialMinutes, initialListId, topBar, onClose }: Props) {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const meInfo = usePerson(me);
  const today = useToday();
  const lists = useData((s) => s.lists);
  const editing = !!task;
  const src = occ ?? null;
  const initialTime = src ? src.dueTime : task ? task.dueTime : initialMinutes != null ? formatHHmm(Math.floor(roundTo5(initialMinutes) / 60), roundTo5(initialMinutes) % 60) : null;
  const initialEarly = task?.earlyReminders?.[0] ?? (task ? null : (meInfo.settings.defaultAlertTimed ?? null));
  const initialRule = parseRuleFields(task?.rrule ?? null);

  const [owner, setOwner] = useState<PersonKey>(task?.owner ?? initialOwner ?? me);
  const [title, setTitle] = useState(src?.title ?? task?.title ?? "");
  const [notes, setNotes] = useState(src?.notes ?? task?.notes ?? "");
  const [dateOn, setDateOn] = useState(!!(src?.dueDate ?? task?.dueDate ?? initialDate) || (!task && !!initialDate));
  const [dueDate, setDueDate] = useState<DateKey>(src?.dueDate ?? task?.dueDate ?? initialDate ?? today);
  const [timeOn, setTimeOn] = useState(!!initialTime);
  const [dueTime, setDueTime] = useState<HHmm>(initialTime ?? "09:00");
  const [showCal, setShowCal] = useState(false);
  const [showWheel, setShowWheel] = useState(false);
  const [repeatKey, setRepeatKey] = useState(repeatPresetKey(task?.rrule ?? null));
  const [customFreq, setCustomFreq] = useState<(typeof FREQS)[number]>(initialRule.freq === "other" ? "weekly" : initialRule.freq);
  const [customInterval, setCustomInterval] = useState(initialRule.interval);
  const [customDays, setCustomDays] = useState<number[]>(initialRule.weekdays);
  const [early, setEarly] = useState<number | null>(initialEarly);
  const customInitially = initialEarly != null && !EARLY_REMINDERS.some((o) => o.value === initialEarly);
  const [customEarly, setCustomEarly] = useState(customInitially);
  const [customEarlyAmount, setCustomEarlyAmount] = useState(customInitially ? (initialEarly! % 1440 === 0 ? initialEarly! / 1440 : initialEarly! % 60 === 0 ? initialEarly! / 60 : initialEarly!) : 10);
  const [customEarlyUnit, setCustomEarlyUnit] = useState<(typeof UNITS)[number]>(customInitially ? (initialEarly! % 1440 === 0 ? "days" : initialEarly! % 60 === 0 ? "hours" : "minutes") : "minutes");
  // A new task goes to the owner's default Reminders list when they sync Reminders: it becomes a reminder too.
  const defaultListFor = (p: PersonKey) => lists.find((l) => isReminderList(l) && l.owner === p && l.isDefault && !l.readOnly)?.id ?? DEFAULT_LIST_ID;
  const [listId, setListId] = useState(task?.listId ?? initialListId ?? defaultListFor(task?.owner ?? initialOwner ?? me));
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [flagged, setFlagged] = useState(!!task?.flagged);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 0);
  const [busy, setBusy] = useState(false);
  const setListPicker = usePickers((s) => s.setList);
  const setTagPicker = usePickers((s) => s.setTags);

  const list = lists.find((l) => l.id === listId) ?? lists[0];
  const inReminders = isReminderList(list);
  const readOnly = !!(inReminders && list?.readOnly);
  // A Reminders list is one person's: the task is theirs. Switching the person takes the task to their lists.
  const pickList = (id: string) => {
    setListId(id);
    const l = lists.find((x) => x.id === id);
    if (isReminderList(l) && l?.owner) setOwner(l.owner);
  };
  const pickOwner = (p: PersonKey) => {
    setOwner(p);
    if (inReminders && list?.owner !== p) setListId(defaultListFor(p));
  };
  const rrule = useMemo(() => {
    if (repeatKey === "custom") return buildRuleBody({ freq: customFreq, interval: customInterval, weekdays: customFreq === "weekly" ? customDays : [] });
    return REPEAT_PRESETS.find((p) => p.key === repeatKey)?.rrule ?? null;
  }, [repeatKey, customFreq, customInterval, customDays]);
  const earlyMinutes = customEarly ? Math.max(1, customEarlyAmount) * (customEarlyUnit === "days" ? 1440 : customEarlyUnit === "hours" ? 60 : 1) : early;
  const valid = title.trim().length > 0 && (repeatKey !== "custom" || customFreq !== "weekly" || customDays.length > 0) && !readOnly;

  const fields = (): TaskFields => ({
    owner,
    listId,
    title: title.trim(),
    notes: notes.trim(),
    dueDate: dateOn ? dueDate : null,
    dueTime: dateOn && timeOn ? dueTime : null,
    timezone: dateOn && timeOn ? (task && task.dueTime === dueTime && task.dueDate === dueDate ? task.timezone : viewerTz) : task?.timezone || viewerTz,
    // Repeating is set in the Reminders app for a reminder; GOOYA does not send a repeat there.
    rrule: dateOn && !inReminders ? rrule : null,
    earlyReminders: dateOn && earlyMinutes != null && earlyMinutes > 0 ? [earlyMinutes] : [],
    tags,
    flagged,
    priority,
  });

  const save = async (scope: EditScope = "future", asked = false) => {
    if (!valid || busy) return;
    if (task && occ && task.rrule && scope === "future" && !asked && task.dueDate && occ.dateKey > task.dueDate) {
      ActionSheetIOS.showActionSheetWithOptions({ title: "This is a repeating task.", options: ["Save for This Task Only", "Save for Future Tasks", "Cancel"], cancelButtonIndex: 2 }, (i) => {
        if (i === 0) void save("this", true);
        if (i === 1) void save("future", true);
      });
      return;
    }
    setBusy(true);
    try {
      if (task) await applyTaskEdit(task, occ ?? null, fields(), scope);
      else await createTask(fields(), me);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (scope: EditScope | "all") => {
    if (!task) return;
    if (await deleteTaskScope(task, occ ?? null, scope)) onClose();
  };
  const askDelete = () => {
    if (task?.source === "apple-reminders" || inReminders) {
      ActionSheetIOS.showActionSheetWithOptions({ message: "This also deletes it from Apple Reminders.", options: ["Delete Reminder", "Cancel"], cancelButtonIndex: 1, destructiveButtonIndex: 0 }, (i) => {
        if (i === 0) void remove("all");
      });
      return;
    }
    if (!task?.rrule) return void remove("all");
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "This is a repeating task.", options: ["Delete This Task Only", "Delete All Future Tasks", "Delete All Tasks", "Cancel"], cancelButtonIndex: 3, destructiveButtonIndex: [0, 1, 2] },
      (i) => {
        if (i === 0) void remove("this");
        if (i === 1) void remove("future");
        if (i === 2) void remove("all");
      },
    );
  };

  const repeatLabels = [...REPEAT_PRESETS.map((p) => p.label), "Custom"];
  const repeatLabel = repeatKey === "custom" ? describeRule(rrule) : (REPEAT_PRESETS.find((p) => p.key === repeatKey)?.label ?? "Never");
  const earlyLabels = [...EARLY_REMINDERS.map((o) => o.label), "Custom"];
  const earlyLabel = earlyMinutes == null ? "None" : earlyReminderLabel(earlyMinutes);
  const dueTimeParts = parseHHmm(dueTime);
  const people = PERSON_KEYS.map((k) => ({ value: k, label: k === "gooya" ? "구야" : "은비" }));

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={editing ? "Details" : "New Task"} onCancel={onClose} onDone={() => void save()} doneLabel={editing ? "Done" : "Add"} doneDisabled={!valid || busy} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topBar}
        <View style={styles.group}>
          <View style={[styles.card, { backgroundColor: colors.bg3 }]}>
            {/* defaultValue, not value: a busy moment in JavaScript must never overwrite what is being typed. */}
            <TextInput autoFocus={!editing} defaultValue={title} onChangeText={setTitle} placeholder={editing ? "Title" : "New Task"} placeholderTextColor={colors.label3} autoCapitalize="sentences" style={[styles.title, { color: colors.label }]} />
            <TextInput defaultValue={notes} onChangeText={setNotes} placeholder="Notes & URL" placeholderTextColor={colors.label3} multiline style={[styles.notes, { color: colors.label }]} />
            {notes && URL_RE.test(notes) ? (
              <View style={styles.links}>
                <LinkifiedNotes text={notes} color={colors.label2} linkColor={colors.blue} />
              </View>
            ) : null}
          </View>
        </View>

        <Group>
          <Row label="For">
            <Segmented<PersonKey> options={people} value={owner} onChange={pickOwner} style={{ width: 170 }} />
          </Row>
        </Group>
        {readOnly ? <Text style={[styles.readOnly, { color: colors.label2 }]}>{list?.name} is read-only in Reminders (a subscribed or shared list), so this can be changed only where it comes from.</Text> : null}

        <SectionTitle>Date & Time</SectionTitle>
        <Group>
          <Row icon="calendar" label="Date" detail={dateOn ? describeDate(dueDate, today) : undefined} onPress={dateOn ? () => setShowCal((v) => !v) : undefined}>
            <Switch
              label="Date"
              value={dateOn}
              onChange={(v) => {
                setDateOn(v);
                setShowCal(v);
                if (!v) {
                  setTimeOn(false);
                  setShowWheel(false);
                }
              }}
            />
          </Row>
          {dateOn && showCal ? (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={dateFromKey(dueDate)}
                mode="date"
                display="inline"
                themeVariant={dark ? "dark" : "light"}
                accentColor={colors.blue}
                onChange={(_, d) => {
                  if (d) setDueDate(keyFromDate(d));
                }}
              />
            </View>
          ) : null}
          <Row icon="clock" label="Time" dim={!dateOn} detail={dateOn && timeOn ? formatHM(dueTimeParts.h, dueTimeParts.min) : undefined} onPress={dateOn && timeOn ? () => setShowWheel((v) => !v) : undefined}>
            <Switch
              label="Time"
              value={dateOn && timeOn}
              disabled={!dateOn}
              onChange={(v) => {
                setTimeOn(v);
                setShowWheel(v);
              }}
            />
          </Row>
          {dateOn && timeOn && showWheel ? (
            <View style={styles.pickerWrap}>
              <DateTimePicker value={dateFromHHmm(dueTime)} mode="time" display="spinner" minuteInterval={5} themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && setDueTime(hhmmFromDate(d))} />
            </View>
          ) : null}
        </Group>

        <Group
          footer={
            !dateOn
              ? undefined
              : inReminders
                ? `Reminders alerts ${timeOn ? "at the due time" : "on the day"}; an early reminder comes from GOOYA. A repeat is set in the Reminders app.`
                : timeOn
                  ? "Alerts at the due time; early reminders fire before it."
                  : "Date-only tasks alert at 9:00 AM."
          }
        >
          <ValueRow icon="repeat" label="Repeat" dim={!dateOn || inReminders} value={inReminders ? "Never" : repeatLabel} options={repeatLabels} title="Repeat" onPick={(_, i) => setRepeatKey(i < REPEAT_PRESETS.length ? REPEAT_PRESETS[i].key : "custom")} />
          {dateOn && !inReminders && repeatKey === "custom" ? (
            <View>
              <ValueRow label="Frequency" value={FREQ_LABELS[FREQS.indexOf(customFreq)]} options={FREQ_LABELS} onPick={(_, i) => setCustomFreq(FREQS[i])} />
              <ValueRow label="Every" value={`${customInterval} ${customFreq === "daily" ? "day(s)" : customFreq === "weekly" ? "week(s)" : customFreq === "monthly" ? "month(s)" : "year(s)"}`} options={Array.from({ length: 12 }, (_, i) => String(i + 1))} onPick={(_, i) => setCustomInterval(i + 1)} />
              {customFreq === "weekly" ? <DayToggles value={customDays} onChange={setCustomDays} /> : null}
            </View>
          ) : null}
          <ValueRow
            icon="bell"
            label="Early Reminder"
            dim={!dateOn}
            value={earlyLabel}
            options={earlyLabels}
            title="Early Reminder"
            onPick={(_, i) => {
              if (i < EARLY_REMINDERS.length) {
                setCustomEarly(false);
                setEarly(EARLY_REMINDERS[i].value);
              } else setCustomEarly(true);
            }}
          />
          {dateOn && customEarly ? (
            <View style={styles.customEarly}>
              <TextInput value={String(customEarlyAmount)} onChangeText={(v) => setCustomEarlyAmount(Math.max(1, Number(v) || 1))} keyboardType="number-pad" style={[styles.amount, { backgroundColor: colors.fill3, color: colors.label }]} />
              <Text onPress={() => pickOption(["minutes before", "hours before", "days before"], `${customEarlyUnit} before`, (_, i) => setCustomEarlyUnit(UNITS[i]))} style={[styles.unit, { backgroundColor: colors.fill3, color: colors.label }]}>
                {customEarlyUnit} before
              </Text>
            </View>
          ) : null}
        </Group>

        <SectionTitle>Organization</SectionTitle>
        <Group>
          <Row
            label={
              <View style={styles.inline}>
                <ListBadge icon={list?.icon ?? "list"} color={list?.color ?? "#0091ff"} />
                <Text style={[styles.rowLabel, { color: colors.label }]}>List</Text>
              </View>
            }
            chevron
            onPress={() => {
              setListPicker({ value: listId, onPick: pickList });
              router.push("/sheet/list");
            }}
          >
            <Text style={[styles.value, { color: colors.label2 }]}>{list?.name ?? "Tasks"}</Text>
          </Row>
          <Row
            icon="number"
            label="Tags"
            chevron
            onPress={() => {
              setTagPicker({ value: tags, onChange: setTags });
              router.push("/sheet/tags");
            }}
          >
            <Text numberOfLines={1} style={[styles.value, { color: colors.label2 }]}>
              {tags.map((t) => `#${t}`).join(" ")}
            </Text>
          </Row>
          <Row icon="flag" iconColor={flagged ? colors.orange : undefined} label="Flag">
            <Switch label="Flag" value={flagged} onChange={setFlagged} />
          </Row>
          <ValueRow icon="exclamationmark" label="Priority" value={PRIORITIES.find((p) => p.value === priority)?.label ?? "None"} options={PRIORITIES.map((p) => p.label)} title="Priority" onPick={(_, i) => setPriority(PRIORITIES[i].value)} />
        </Group>

        {editing && !readOnly ? <DestructiveButton onPress={askDelete}>{task?.source === "apple-reminders" || inReminders ? "Delete Reminder" : "Delete Task"}</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  readOnly: { paddingHorizontal: 32, marginTop: -8, fontSize: 15, lineHeight: 20 },
  fill: { flex: 1 },
  content: { gap: 20, paddingBottom: 60, paddingTop: 4 },
  group: { paddingHorizontal: 16 },
  card: { borderRadius: 14, overflow: "hidden" },
  title: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, fontSize: 26, fontWeight: "500", lineHeight: 32 },
  notes: { paddingHorizontal: 16, paddingBottom: 14, fontSize: 17, lineHeight: 22, minHeight: 60 },
  links: { paddingHorizontal: 16, paddingBottom: 12 },
  pickerWrap: { paddingHorizontal: 8, paddingBottom: 6 },
  customEarly: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  amount: { width: 70, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, fontSize: 15 },
  unit: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, overflow: "hidden" },
  inline: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 17 },
  value: { fontSize: 17, flexShrink: 1 },
});
