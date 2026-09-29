import DateTimePicker from "@react-native-community/datetimepicker";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import type { DateKey, Schedule, ScheduleKind } from "@shared/model";
import { PERSON_KEYS, type PersonKey } from "@shared/people";
import { buildRuleBody, parseRuleFields } from "@shared/recurrence";
import { addDaysKey, minutesOf } from "@shared/time";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DayToggles, DestructiveButton, Group, Row, Switch, TextRow, ValueRow } from "@/components/Form";
import { Segmented } from "@/components/Segmented";
import { DetailsBar } from "@/components/SheetHeader";
import { dateFromHHmm, dateFromKey, hhmmFromDate, keyFromDate } from "@/lib/dates";
import { deleteSchedule, newId, saveSchedule } from "@/lib/db";
import { formatMediumDate } from "@/lib/format";
import { useMe, usePerson } from "@/lib/people";
import { overrideScheduleDay } from "@/lib/scheduleOps";
import { useToday } from "@/lib/useNow";
import { useColors, useIsDark } from "@/theme";

const PRESETS: Record<ScheduleKind, { title: string; icon: string; start: string; end: string; freq: "daily" | "weekly"; days: number[] }> = {
  sleep: { title: "Sleep", icon: "💤", start: "23:00", end: "07:00", freq: "daily", days: [] },
  work: { title: "Work", icon: "💼", start: "09:00", end: "17:00", freq: "weekly", days: [1, 2, 3, 4, 5] },
  custom: { title: "", icon: "📌", start: "09:00", end: "10:00", freq: "weekly", days: [1, 2, 3, 4, 5] },
};

interface Props {
  schedule?: Schedule;
  dayOnly?: DateKey;
  initialOwner?: PersonKey;
  initialDate?: DateKey;
  initialMinutes?: number;
  topBar?: ReactNode;
  onClose: () => void;
}

export function ScheduleEditor({ schedule, dayOnly, initialOwner, initialDate, initialMinutes, topBar, onClose }: Props) {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const today = useToday();
  const editing = !!schedule;
  const dayOv = schedule && dayOnly ? schedule.overrides?.[dayOnly] : undefined;
  const preset = PRESETS[schedule?.kind ?? "work"];
  const rule = parseRuleFields(schedule?.rrule ?? null);
  const initialStart = initialMinutes != null && !schedule ? `${String(Math.floor(initialMinutes / 60)).padStart(2, "0")}:${String(initialMinutes % 60).padStart(2, "0")}` : (dayOv?.startTime ?? schedule?.startTime ?? preset.start);
  const initialEnd = initialMinutes != null && !schedule ? `${String((Math.floor(initialMinutes / 60) + 1) % 24).padStart(2, "0")}:${String(initialMinutes % 60).padStart(2, "0")}` : (dayOv?.endTime ?? schedule?.endTime ?? preset.end);

  const [owner, setOwner] = useState<PersonKey>(schedule?.owner ?? initialOwner ?? me);
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? "work");
  const [title, setTitle] = useState(dayOv?.title ?? schedule?.title ?? preset.title);
  const [icon, setIcon] = useState(schedule?.icon ?? preset.icon);
  const [freq, setFreq] = useState<"daily" | "weekly">(schedule ? (rule.freq === "daily" ? "daily" : "weekly") : preset.freq);
  const [interval, setInterval] = useState(schedule ? rule.interval : 1);
  const [days, setDays] = useState<number[]>(schedule ? (rule.freq === "weekly" ? rule.weekdays : []) : preset.days);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [startDate, setStartDate] = useState<DateKey>(schedule?.startDate ?? initialDate ?? today);
  const [hasEnd, setHasEnd] = useState(!!schedule?.endDate);
  const [endDate, setEndDate] = useState<DateKey>(schedule?.endDate ?? addDaysKey(initialDate ?? today, 90));
  const [color, setColor] = useState<string | null>(schedule?.color ?? null);
  const [busy, setBusy] = useState(false);

  const ownerInfo = usePerson(owner);
  const crossesMidnight = minutesOf(endTime) <= minutesOf(startTime);

  const applyPreset = (k: ScheduleKind) => {
    setKind(k);
    if (editing) return;
    const p = PRESETS[k];
    setTitle(p.title);
    setIcon(p.icon);
    setStartTime(p.start);
    setEndTime(p.end);
    setFreq(p.freq);
    setDays(p.days);
  };

  const valid = title.trim().length > 0 && (freq === "daily" || days.length > 0) && (!hasEnd || endDate >= startDate);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (schedule && dayOnly) await overrideScheduleDay(schedule, dayOnly, { title: title.trim(), startTime, endTime });
      else {
        const now = Date.now();
        await saveSchedule({
          id: schedule?.id ?? newId(),
          owner,
          title: title.trim(),
          icon: icon.trim() || "📌",
          kind,
          color,
          startTime,
          endTime,
          timezone: schedule?.timezone ?? ownerInfo.timezone,
          rrule: buildRuleBody({ freq, interval, weekdays: freq === "weekly" ? days : [] }),
          startDate,
          endDate: hasEnd ? endDate : null,
          exdates: schedule?.exdates ?? [],
          overrides: schedule?.overrides ?? {},
          createdAt: schedule?.createdAt ?? now,
          updatedAt: now,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const tzNote = useMemo(() => `Times are in ${ownerInfo.name}’s time zone (${ownerInfo.timezone.replace("_", " ")}).`, [ownerInfo]);
  const timePicker = (value: string, onChange: (t: string) => void) => (
    <DateTimePicker value={dateFromHHmm(value)} mode="time" display="compact" minuteInterval={5} themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(hhmmFromDate(d))} />
  );
  const datePicker = (value: DateKey, onChange: (k: DateKey) => void, min?: DateKey) => (
    <DateTimePicker value={dateFromKey(value)} minimumDate={min ? dateFromKey(min) : undefined} mode="date" display="compact" themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(keyFromDate(d))} />
  );
  const people = PERSON_KEYS.map((k) => ({ value: k, label: k === "gooya" ? "구야" : "은비" }));

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={dayOnly ? formatMediumDate(dayOnly, false) : editing ? "Edit Schedule" : "New Schedule"} onCancel={onClose} onDone={() => void save()} doneLabel={editing ? "Done" : "Add"} doneDisabled={!valid || busy} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topBar}
        {!dayOnly ? (
          <Group>
            <Row label="For">
              <Segmented<PersonKey> options={people} value={owner} onChange={setOwner} style={{ width: 170 }} />
            </Row>
            <Row label="Type">
              <Segmented<ScheduleKind>
                options={[
                  { value: "sleep", label: "💤 Sleep" },
                  { value: "work", label: "💼 Work" },
                  { value: "custom", label: "Custom" },
                ]}
                value={kind}
                onChange={applyPreset}
                style={{ width: 220 }}
              />
            </Row>
          </Group>
        ) : null}

        <Group footer={dayOnly ? "Changes apply to this day only." : undefined}>
          <TextRow
            // A preset (Work, Sleep…) fills in the title: the row starts again with it.
            key={editing ? "title" : `title-${kind}`}
            value={title}
            onChange={setTitle}
            placeholder="Title"
            leading={dayOnly ? <Text style={styles.icon}>{icon}</Text> : <TextInput value={icon} onChangeText={(v) => setIcon(v.slice(-2))} accessibilityLabel="Icon" style={[styles.iconInput, { color: colors.label }]} />}
          />
        </Group>

        <Group footer={crossesMidnight ? "Ends the next day." : undefined}>
          <Row label="Starts">{timePicker(startTime, setStartTime)}</Row>
          <Row label="Ends">{timePicker(endTime, setEndTime)}</Row>
        </Group>

        {!dayOnly ? (
          <>
            <Group footer={tzNote}>
              <Row label="Repeat">
                <Segmented<"daily" | "weekly">
                  options={[
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                  value={freq}
                  onChange={setFreq}
                  style={{ width: 170 }}
                />
              </Row>
              <ValueRow label="Every" value={interval === 1 ? (freq === "daily" ? "day" : "week") : `${interval} ${freq === "daily" ? "days" : "weeks"}`} options={[1, 2, 3, 4, 5, 6].map((n) => (n === 1 ? (freq === "daily" ? "day" : "week") : `${n} ${freq === "daily" ? "days" : "weeks"}`))} onPick={(_, i) => setInterval(i + 1)} />
              {freq === "weekly" ? <DayToggles value={days} onChange={setDays} /> : null}
            </Group>

            <Group>
              <Row label="Starts on">{datePicker(startDate, setStartDate)}</Row>
              <Row label="End Repeat">
                <Switch label="End repeat" value={hasEnd} onChange={setHasEnd} />
              </Row>
              {hasEnd ? <Row label="Ends on">{datePicker(endDate, setEndDate, startDate)}</Row> : null}
            </Group>

            <Group header="Color" footer={color ? undefined : `Uses ${ownerInfo.name}’s colour.`}>
              <Row label="Color">
                {color ? (
                  <Pressable accessibilityRole="button" onPress={() => setColor(null)} hitSlop={8}>
                    <Text style={{ color: colors.blue, fontSize: 17 }}>Use owner’s</Text>
                  </Pressable>
                ) : null}
                <Host matchContents style={styles.colorHost}>
                  <ColorPicker selection={color ?? (dark ? ownerInfo.hexDark : ownerInfo.hexLight)} supportsOpacity={false} onSelectionChange={(c) => setColor(c.slice(0, 7))} />
                </Host>
              </Row>
            </Group>
          </>
        ) : null}

        {editing && !dayOnly ? <DestructiveButton onPress={() => void deleteSchedule(schedule.id).then(onClose)}>Delete Schedule</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 20, paddingBottom: 60, paddingTop: 4 },
  icon: { fontSize: 22 },
  iconInput: { width: 34, textAlign: "center", fontSize: 22 },
  colorHost: { width: 44, height: 32 },
});
