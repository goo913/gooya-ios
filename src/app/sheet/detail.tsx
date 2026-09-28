import { describeRule, expandEvent, expandSchedule } from "@shared/recurrence";
import { DAY_MS, addDaysKey, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DestructiveButton, Group, Row } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { deleteSchedule } from "@/lib/db";
import { formatLongDate, formatTime, tzAbbrev } from "@/lib/format";
import { colorHex, usePerson } from "@/lib/people";
import { deleteScheduleDay, endScheduleBefore } from "@/lib/scheduleOps";
import { viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors, useIsDark } from "@/theme";

/** A schedule's or an imported event's summary, with its actions (a small sheet that fits its content). */
export default function DetailSheet() {
  const req = useSheets((s) => s.detail);
  const colors = useColors();
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  return (
    <View style={{ backgroundColor: colors.bg2 }}>
      {req?.kind === "schedule" ? <ScheduleDetail scheduleId={req.scheduleId} dateKey={req.dateKey} /> : null}
      {req?.kind === "event" ? <EventDetail eventId={req.eventId} dateKey={req.dateKey} /> : null}
    </View>
  );
}

function CloseButton() {
  const colors = useColors();
  return (
    <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={[styles.close, { backgroundColor: colors.fill3 }]}>
      <Icon name="xmark" size={14} color={colors.label2} weight="bold" />
    </Pressable>
  );
}

function ScheduleDetail({ scheduleId, dateKey }: { scheduleId: string; dateKey: string }) {
  const colors = useColors();
  const dark = useIsDark();
  const schedule = useData((s) => s.schedules.find((t) => t.id === scheduleId));
  const openEditor = useSheets((s) => s.openEditor);
  const closeDetail = useSheets((s) => s.closeDetail);
  const owner = usePerson(schedule?.owner ?? "gooya");
  const occ = useMemo(() => {
    if (!schedule) return null;
    const from = startOfDayMs(dateKey, schedule.timezone) - DAY_MS;
    const to = startOfDayMs(addDaysKey(dateKey, 1), schedule.timezone) + DAY_MS;
    return expandSchedule(schedule, from, to).find((o) => o.dateKey === dateKey) ?? null;
  }, [schedule, dateKey]);
  if (!schedule || !occ) return <Text style={[styles.empty, { color: colors.label2 }]}>This schedule no longer exists.</Text>;
  const ownerTimes = `${formatTime(occ.start, schedule.timezone)} – ${formatTime(occ.end, schedule.timezone)} ${tzAbbrev(schedule.timezone, occ.start)}`;
  const localTimes = schedule.timezone !== viewerTz ? `${formatTime(occ.start, viewerTz)} – ${formatTime(occ.end, viewerTz)} ${tzAbbrev(viewerTz, occ.start)}` : null;
  const edit = (dayOnly: boolean) => {
    openEditor({ kind: "schedule", schedule, dayOnly: dayOnly ? dateKey : undefined });
    router.replace("/sheet/edit");
  };
  const done = () => {
    closeDetail();
    router.back();
  };
  return (
    <View style={styles.body}>
      <SheetBar title="" left={<CloseButton />} right={<BarButton onPress={() => edit(false)}>Edit</BarButton>} />
      <View style={styles.text}>
        <Text style={[styles.h2, { color: colors.label }]}>
          {occ.icon} {occ.title}
        </Text>
        <View style={styles.ownerRow}>
          <View style={[styles.dot, { backgroundColor: colorHex(owner.color, dark) }]} />
          <Text style={[styles.sub, { color: colors.label2 }]}>
            {owner.name} · {describeRule(schedule.rrule)}
          </Text>
        </View>
        <Text style={[styles.line, { color: colors.label, marginTop: 10 }]}>{formatLongDate(dateKey)}</Text>
        <Text style={[styles.line, { color: colors.label2 }]}>{ownerTimes}</Text>
        {localTimes ? <Text style={[styles.small, { color: colors.label3 }]}>{localTimes} for you</Text> : null}
        {schedule.overrides?.[dateKey] ? <Text style={[styles.small, { color: colors.orange, marginTop: 4 }]}>Edited for this day only</Text> : null}
      </View>
      <Group>
        <Row label="Edit This Day Only" onPress={() => edit(true)} chevron />
        <Row label="Delete This Day Only" labelColor={colors.red} onPress={() => void deleteScheduleDay(schedule, dateKey).then(done)} />
        <Row label="Delete All Future" labelColor={colors.red} onPress={() => void endScheduleBefore(schedule, dateKey).then(done)} />
      </Group>
      <DestructiveButton onPress={() => void deleteSchedule(schedule.id).then(done)}>Delete Schedule</DestructiveButton>
    </View>
  );
}

function EventDetail({ eventId, dateKey }: { eventId: string; dateKey: string }) {
  const colors = useColors();
  const event = useData((s) => s.events.find((e) => e.id === eventId));
  const owner = usePerson(event?.owner ?? "gooya");
  const occ = useMemo(() => {
    if (!event) return null;
    const from = startOfDayMs(dateKey, viewerTz) - DAY_MS;
    const to = startOfDayMs(addDaysKey(dateKey, 1), viewerTz) + DAY_MS;
    return expandEvent(event, from, to).find((o) => o.dateKey === dateKey) ?? expandEvent(event, from, to)[0] ?? null;
  }, [event, dateKey]);
  if (!event || !occ) return <Text style={[styles.empty, { color: colors.label2 }]}>This event no longer exists.</Text>;
  const when = occ.allDay ? "all-day" : `${formatTime(occ.start, viewerTz)} – ${formatTime(occ.end, viewerTz)}`;
  return (
    <View style={styles.body}>
      <SheetBar title="" left={<CloseButton />} />
      <View style={styles.text}>
        <Text style={[styles.h2, { color: colors.label }]}>{occ.title}</Text>
        <View style={styles.ownerRow}>
          <View style={[styles.dot, { backgroundColor: event.color }]} />
          <Text style={[styles.sub, { color: colors.label2 }]}>
            {event.calendarName} · {owner.name}
          </Text>
          <SourceBadge source={event.source} size={12} color={colors.label2} />
        </View>
        <Text style={[styles.line, { color: colors.label, marginTop: 10 }]}>{formatLongDate(occ.dateKey)}</Text>
        <Text style={[styles.line, { color: colors.label2 }]}>{when}</Text>
        {event.location ? <Text style={[styles.small, { color: colors.label3 }]}>{event.location}</Text> : null}
        {event.notes ? <Text style={[styles.notes, { color: colors.label2 }]}>{event.notes}</Text> : null}
        {event.rrule ? <Text style={[styles.small, { color: colors.label3 }]}>{describeRule(event.rrule)}</Text> : null}
      </View>
      <Text style={[styles.foot, { color: colors.label3 }]}>{event.editable ? "Edit it in the calendar it came from; changes sync back within minutes." : "Imported read-only from the calendar it came from."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 24, gap: 20 },
  text: { paddingHorizontal: 20 },
  h2: { fontSize: 24, fontWeight: "700", lineHeight: 29 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sub: { fontSize: 15 },
  line: { fontSize: 17, lineHeight: 22 },
  small: { fontSize: 15, lineHeight: 20 },
  notes: { fontSize: 15, lineHeight: 20, marginTop: 8 },
  foot: { paddingHorizontal: 20, fontSize: 13 },
  empty: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, textAlign: "center", fontSize: 15 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
