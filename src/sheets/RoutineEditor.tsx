import DateTimePicker from "@react-native-community/datetimepicker";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import type { DateKey, Routine, RoutineKind } from "@shared/model";
import { PERSON_KEYS, otherPerson, type PersonKey } from "@shared/people";
import { buildRuleBody, parseRuleFields } from "@shared/recurrence";
import { addDaysKey, minutesOf, zonedMs } from "@shared/time";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DayToggles, DestructiveButton, Group, Row, Switch, TextRow, ValueRow } from "@/components/Form";
import { Segmented } from "@/components/Segmented";
import { DetailsBar } from "@/components/SheetHeader";
import { dateFromHHmm, dateFromKey, hhmmFromDate, keyFromDate } from "@/lib/dates";
import { deleteRoutine, newId, saveRoutine } from "@/lib/db";
import { formatMediumDate } from "@/lib/format";
import { useMe, usePerson } from "@/lib/people";
import { overrideRoutineDay } from "@/lib/routineOps";
import { useToday } from "@/lib/useNow";
import { clockOf, useEditZones } from "@/lib/zones";
import { useColors, useIsDark } from "@/theme";

const PRESETS: Record<RoutineKind, { title: string; icon: string; start: string; end: string; freq: "daily" | "weekly"; days: number[] }> = {
  sleep: { title: "Sleep", icon: "💤", start: "23:00", end: "07:00", freq: "daily", days: [] },
  work: { title: "Work", icon: "💼", start: "09:00", end: "17:00", freq: "weekly", days: [1, 2, 3, 4, 5] },
  custom: { title: "", icon: "📌", start: "09:00", end: "10:00", freq: "weekly", days: [1, 2, 3, 4, 5] },
};

interface Props {
  routine?: Routine;
  dayOnly?: DateKey;
  initialOwner?: PersonKey;
  initialDate?: DateKey;
  initialMinutes?: number;
  topBar?: ReactNode;
  onClose: () => void;
}

export function RoutineEditor({ routine, dayOnly, initialOwner, initialDate, initialMinutes, topBar, onClose }: Props) {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const today = useToday();
  const editing = !!routine;
  const dayOv = routine && dayOnly ? routine.overrides?.[dayOnly] : undefined;
  const preset = PRESETS[routine?.kind ?? "work"];
  const rule = parseRuleFields(routine?.rrule ?? null);
  const initialStart = initialMinutes != null && !routine ? `${String(Math.floor(initialMinutes / 60)).padStart(2, "0")}:${String(initialMinutes % 60).padStart(2, "0")}` : (dayOv?.startTime ?? routine?.startTime ?? preset.start);
  const initialEnd = initialMinutes != null && !routine ? `${String((Math.floor(initialMinutes / 60) + 1) % 24).padStart(2, "0")}:${String(initialMinutes % 60).padStart(2, "0")}` : (dayOv?.endTime ?? routine?.endTime ?? preset.end);

  const [owner, setOwner] = useState<PersonKey>(routine?.owner ?? initialOwner ?? me);
  const [kind, setKind] = useState<RoutineKind>(routine?.kind ?? "work");
  const [title, setTitle] = useState(dayOv?.title ?? routine?.title ?? preset.title);
  const [icon, setIcon] = useState(routine?.icon ?? preset.icon);
  const [freq, setFreq] = useState<"daily" | "weekly">(routine ? (rule.freq === "daily" ? "daily" : "weekly") : preset.freq);
  const [interval, setInterval] = useState(routine ? rule.interval : 1);
  const [days, setDays] = useState<number[]>(routine ? (rule.freq === "weekly" ? rule.weekdays : []) : preset.days);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [startDate, setStartDate] = useState<DateKey>(routine?.startDate ?? initialDate ?? today);
  const [hasEnd, setHasEnd] = useState(!!routine?.endDate);
  const [endDate, setEndDate] = useState<DateKey>(routine?.endDate ?? addDaysKey(initialDate ?? today, 90));
  const [color, setColor] = useState<string | null>(routine?.color ?? null);
  const [shared, setShared] = useState(!routine?.private);
  const [busy, setBusy] = useState(false);
  const otherName = usePerson(otherPerson(me)).name;

  const ownerInfo = usePerson(owner);
  const crossesMidnight = minutesOf(endTime) <= minutesOf(startTime);
  // A routine is on its owner's clock (9 to 5 where they are); this phone's clock shows the same hours on the day it
  // starts (or today), and takes changes too.
  const zone = routine?.timezone ?? ownerInfo.timezone;
  const refDate = dayOnly ?? (startDate > today ? startDate : today);
  const startAt = zonedMs(refDate, startTime, zone);
  const endAt = zonedMs(crossesMidnight ? addDaysKey(refDate, 1) : refDate, endTime, zone);
  const zones = useEditZones(owner, startAt, zone);

  const applyPreset = (k: RoutineKind) => {
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
      if (routine && dayOnly) await overrideRoutineDay(routine, dayOnly, { title: title.trim(), startTime, endTime });
      else {
        const now = Date.now();
        await saveRoutine({
          id: routine?.id ?? newId(),
          owner,
          title: title.trim(),
          icon: icon.trim() || "📌",
          kind,
          color,
          startTime,
          endTime,
          timezone: routine?.timezone ?? ownerInfo.timezone,
          rrule: buildRuleBody({ freq, interval, weekdays: freq === "weekly" ? days : [] }),
          startDate,
          endDate: hasEnd ? endDate : null,
          exdates: routine?.exdates ?? [],
          overrides: routine?.overrides ?? {},
          // Only one's own routine can be kept to oneself.
          private: owner === me && !shared,
          createdAt: routine?.createdAt ?? now,
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
  /** A time on the other clock: picked there, kept as the owner's wall-clock time. */
  const otherPicker = (at: number, onChange: (t: string) => void) => (
    <DateTimePicker value={new Date(at)} mode="time" display="compact" minuteInterval={5} timeZoneName={zones[1]?.zone} themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(clockOf(d.getTime(), zone).time)} />
  );
  const datePicker = (value: DateKey, onChange: (k: DateKey) => void, min?: DateKey) => (
    <DateTimePicker value={dateFromKey(value)} minimumDate={min ? dateFromKey(min) : undefined} mode="date" display="compact" themeVariant={dark ? "dark" : "light"} onChange={(_, d) => d && onChange(keyFromDate(d))} />
  );
  const people = PERSON_KEYS.map((k) => ({ value: k, label: k === "gooya" ? "구야" : "은비" }));

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <DetailsBar title={dayOnly ? formatMediumDate(dayOnly, false) : editing ? "Edit Routine" : "New Routine"} onCancel={onClose} onDone={() => void save()} doneLabel={editing ? "Done" : "Add"} doneDisabled={!valid || busy} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topBar}
        {!dayOnly ? (
          <Group>
            <Row label="For">
              <Segmented<PersonKey> options={people} value={owner} onChange={setOwner} style={{ width: 170 }} />
            </Row>
            <Row label="Type">
              <Segmented<RoutineKind>
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

        <Group header={zones.length > 1 ? zones[0].label : undefined} footer={crossesMidnight ? "Ends the next day." : undefined}>
          <Row label="Starts">{timePicker(startTime, setStartTime)}</Row>
          <Row label="Ends">{timePicker(endTime, setEndTime)}</Row>
        </Group>
        {zones.length > 1 ? (
          <Group header={zones[1].label} footer={`The same hours on ${formatMediumDate(refDate, false)} on this clock; change either one and the other follows.`}>
            <Row label="Starts">{otherPicker(startAt, setStartTime)}</Row>
            <Row label="Ends">{otherPicker(endAt, setEndTime)}</Row>
          </Group>
        ) : null}

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

            <Group header="Color" footer={color ? undefined : `Uses ${ownerInfo.name}’s color.`}>
              <Row label="Color">
                {color ? (
                  <Pressable accessibilityRole="button" onPress={() => setColor(null)} hitSlop={8}>
                    <Text style={{ color: colors.blue, fontSize: 17 }}>Use owner’s</Text>
                  </Pressable>
                ) : null}
                <View style={styles.colorWell}>
                  <Host matchContents>
                    <ColorPicker selection={color ?? (dark ? ownerInfo.hexDark : ownerInfo.hexLight)} supportsOpacity={false} onSelectionChange={(c) => setColor(c.slice(0, 7))} />
                  </Host>
                </View>
              </Row>
            </Group>
          </>
        ) : null}

        {!dayOnly && owner === me ? (
          <Group footer={shared ? `${otherName} sees it too.` : `Only you see it: not in ${otherName}’s day view.`}>
            <Row label={`Share with ${otherName}`}>
              <Switch label={`Share with ${otherName}`} value={shared} onChange={setShared} />
            </Row>
          </Group>
        ) : null}

        {editing && !dayOnly ? <DestructiveButton onPress={() => void deleteRoutine(routine.id).then(onClose)}>Delete Routine</DestructiveButton> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 20, paddingBottom: 60, paddingTop: 4 },
  icon: { fontSize: 22 },
  iconInput: { width: 34, textAlign: "center", fontSize: 22 },
  colorWell: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
