import type { DateKey, Task, TaskOccurrence } from "@shared/model";
import { describeRule, expandEvent, expandRoutine, expandTask } from "@shared/recurrence";
import { DAY_MS, addDaysKey, minutesSinceMidnight, startOfDayMs } from "@shared/time";
import { router } from "expo-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TaskRing } from "@/components/Chips";
import { GlassCapsule } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { SourceBadge } from "@/components/SourceBadge";
import { earlyReminderLabel } from "@/lib/alerts";
import { mix } from "@/lib/color";
import { deleteRoutine } from "@/lib/db";
import { MONTH_SHORT, WEEKDAY_LONG, formatTime, hourLabel, tzAbbrev } from "@/lib/format";
import { colorHex, useMe, usePerson, usePersonColor, useTaskColor } from "@/lib/people";
import { deleteRoutineDay, endRoutineBefore } from "@/lib/routineOps";
import { reminderOwnerName } from "@/lib/reminders";
import { deleteTaskScope, setCompleted } from "@/lib/taskOps";
import { reminderIdOf } from "@shared/reminders";
import { plainNotes } from "@shared/calendarCopy";
import { hasEndTime, scheduleAsEvent } from "@shared/schedules";
import { viewerTz } from "@/lib/useNow";
import { useData } from "@/store/data";
import { useSheets } from "@/store/sheets";
import { useColors, useIsDark } from "@/theme";

/**
 * What a tap on a task, a routine or an imported event opens: Apple Calendar's details sheet (iOS 26/27). A close
 * button and Edit on glass at the top, the title with its ring or colour bar, the date and time, the facts that matter,
 * a small timeline around the item, then the actions.
 */
export default function DetailSheet() {
  const req = useSheets((s) => s.detail);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {req?.kind === "task" ? <TaskDetail taskId={req.taskId} dateKey={req.dateKey} /> : null}
        {req?.kind === "routine" ? <RoutineDetail routineId={req.routineId} dateKey={req.dateKey} /> : null}
        {req?.kind === "event" ? <EventDetail eventId={req.eventId} dateKey={req.dateKey} /> : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- pieces

/** "Tuesday, Sep 29, 2026" */
function longDate(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

function Top({ onEdit }: { onEdit?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} hitSlop={6}>
        <GlassCapsule style={styles.round}>
          <Icon name="xmark" size={19} weight="semibold" color={colors.label} />
        </GlassCapsule>
      </Pressable>
      {onEdit ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onEdit} hitSlop={6}>
          <GlassCapsule style={styles.editPill}>
            <Text style={[styles.editText, { color: colors.label }]}>Edit</Text>
          </GlassCapsule>
        </Pressable>
      ) : null}
    </View>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: colors.label2 }]}>{label}</Text>
      {typeof children === "string" ? <Text style={[styles.factValue, { color: colors.label2 }]}>{children}</Text> : children}
    </View>
  );
}

function ActionButton({ label, destructive, onPress }: { label: string; destructive?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.fill : colors.bg3 }]}>
      <Text style={[styles.actionText, { color: destructive ? colors.red : colors.label }]}>{label}</Text>
    </Pressable>
  );
}

/** A few hours of the day around the item, as Apple shows under an event's details. */
function MiniTimeline({ startMin, endMin, children }: { startMin: number; endMin: number; children: (hourH: number, firstHour: number) => ReactNode }) {
  const colors = useColors();
  const hourH = 48;
  const firstHour = Math.max(0, Math.min(20, Math.floor(startMin / 60) - 1));
  const hours = [0, 1, 2, 3].map((i) => firstHour + i);
  const height = Math.max(hourH * 3.2, ((Math.min(endMin, (firstHour + 4) * 60) - firstHour * 60) / 60) * hourH + 24);
  return (
    <View style={[styles.mini, { backgroundColor: colors.bg3, height: Math.min(height, hourH * 3.6) }]}>
      {hours.map((h, i) => {
        const l = hourLabel(h);
        const y = 18 + i * hourH;
        return (
          <View key={h} pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.miniLabel, { top: y - 12 }]}>
              {h === 12 ? (
                <Text allowFontScaling={false} style={[styles.miniNoon, { color: colors.label2 }]}>Noon</Text>
              ) : (
                <>
                  <Text allowFontScaling={false} style={[styles.miniNum, { color: colors.label2 }]}>{l.num}</Text>
                  <Text allowFontScaling={false} style={[styles.miniSuffix, { color: colors.label2 }]}>{l.suffix}</Text>
                </>
              )}
            </View>
            <View style={[styles.miniLine, { top: y, backgroundColor: colors.separator }]} />
          </View>
        );
      })}
      <View style={[styles.miniBody, { top: 18 }]}>{children(hourH, firstHour)}</View>
    </View>
  );
}

// ---------------------------------------------------------------- task

function useTaskOccurrence(task: Task | undefined, dateKey: DateKey): TaskOccurrence | null {
  return useMemo(() => {
    if (!task) return null;
    const from = startOfDayMs(dateKey, task.timezone || viewerTz) - DAY_MS;
    const to = startOfDayMs(addDaysKey(dateKey, 1), task.timezone || viewerTz) + DAY_MS;
    const all = expandTask(task, from, to);
    return all.find((o) => o.dateKey === dateKey) ?? all.find((o) => o.dueDate === dateKey) ?? all[0] ?? null;
  }, [task, dateKey]);
}

function TaskDetail({ taskId, dateKey }: { taskId: string; dateKey: DateKey }) {
  const colors = useColors();
  const dark = useIsDark();
  const task = useData((s) => s.tasks.find((t) => t.id === taskId));
  const list = useData((s) => s.lists.find((l) => l.id === task?.listId));
  const owner = usePerson(task?.owner ?? "gooya");
  const occ = useTaskOccurrence(task, dateKey);
  const openEditor = useSheets((s) => s.openEditor);
  const closeDetail = useSheets((s) => s.closeDetail);
  const ring = useTaskColor(task ?? { owner: owner.key, listId: "" });
  if (!task || !occ) return <Missing what="task" />;
  const edit = () => {
    openEditor({ kind: "task", task, occ });
    router.replace("/sheet/edit");
  };
  const done = () => {
    closeDetail();
    router.back();
  };
  const fromReminders = !!reminderIdOf(task);
  const remove = () => {
    const options = fromReminders ? ["Delete Reminder", "Cancel"] : task.rrule ? ["Delete This Task Only", "Delete All Future Tasks", "Delete All Tasks", "Cancel"] : ["Delete Task", "Cancel"];
    const message = fromReminders ? "This also deletes it from Apple Reminders." : undefined;
    ActionSheetIOS.showActionSheetWithOptions({ options, message, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.map((_, i) => i).slice(0, -1) }, (i) => {
      if (i === options.length - 1) return;
      const scope = !task.rrule ? "all" : i === 0 ? "this" : i === 1 ? "future" : "all";
      void deleteTaskScope(task, occ, scope).then((deleted) => deleted && done());
    });
  };
  const time = occ.allDay ? null : formatTime(occ.start, viewerTz);
  const ownTime = !occ.allDay && task.timezone && task.timezone !== viewerTz ? `${formatTime(occ.start, task.timezone)} ${tzAbbrev(task.timezone, occ.start)} for ${owner.name}` : null;
  const startMin = occ.allDay ? 9 * 60 : minutesSinceMidnight(occ.start, viewerTz);
  const bangs = ["", "!", "!!", "!!!"][task.priority ?? 0];
  return (
    <View>
      <Top onEdit={edit} />
      <View style={styles.titleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={occ.completed ? "Mark incomplete" : "Mark complete"} onPress={() => void setCompleted(task, occ.dateKey, !occ.completed)} hitSlop={10}>
          <TaskRing color={ring} done={occ.completed} size={32} />
        </Pressable>
        <Text style={[styles.taskTitle, { color: occ.completed ? colors.label2 : colors.label }]}>
          {bangs ? <Text style={{ color: colors.orange }}>{bangs} </Text> : null}
          {occ.title}
          {task.flagged ? <Text style={{ color: colors.orange }}> ⚑</Text> : null}
        </Text>
      </View>
      <View style={styles.when}>
        <Text style={[styles.whenText, { color: colors.label2 }]}>{longDate(occ.dueDate)}</Text>
        {time ? <Text style={[styles.whenText, { color: colors.label2 }]}>{time}</Text> : null}
        {ownTime ? <Text style={[styles.small, { color: colors.label3 }]}>{ownTime}</Text> : null}
        {task.rrule ? (
          <View style={styles.repeat}>
            <Icon name="repeat" size={17} color={colors.label2} />
            <Text style={[styles.whenText, { color: colors.label2, flex: 1 }]}>{describeRule(task.rrule)}</Text>
          </View>
        ) : null}
        {occ.completed ? <Text style={[styles.small, { color: colors.green }]}>Completed</Text> : null}
      </View>
      <Fact label="Person">
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: ring }]} />
          <Text style={[styles.factValue, { color: colors.label2 }]}>{owner.name}</Text>
        </View>
      </Fact>
      <Fact label="List">{list?.name ?? "Tasks"}</Fact>
      {fromReminders ? <Fact label="From">{`${reminderOwnerName(task) ?? owner.name}’s Apple Reminders${task.tags?.[0] ? ` · ${task.externalRefs?.[0]?.calendarId || task.tags[0]}` : ""}`}</Fact> : null}
      {task.earlyReminders?.length ? <Fact label="Early Reminder">{earlyReminderLabel(task.earlyReminders[0])}</Fact> : null}
      {task.tags?.length ? <Fact label="Tags">{task.tags.map((t) => `#${t}`).join("  ")}</Fact> : null}
      {occ.notes ? (
        <Fact label="Notes">
          <Text selectable style={[styles.notes, { color: colors.label2 }]}>
            {occ.notes}
          </Text>
        </Fact>
      ) : null}
      {!occ.allDay ? (
        <MiniTimeline startMin={startMin} endMin={startMin + 30}>
          {(hourH, firstHour) => (
            <View style={[styles.miniTask, { top: ((startMin - firstHour * 60) / 60) * hourH, height: hourH / 2 - 1, backgroundColor: mix(colors.label, colors.bg3, dark ? 0.24 : 0.12), borderColor: colors.taskBlockRim }]}>
              <TaskRing color={ring} done={occ.completed} size={15} />
              <Text numberOfLines={1} allowFontScaling={false} style={[styles.miniTitle, { color: colors.label }]}>
                {occ.title}
              </Text>
            </View>
          )}
        </MiniTimeline>
      ) : null}
      <View style={styles.actions}>
        <ActionButton label={occ.completed ? "Mark as Incomplete" : "Mark as Completed"} onPress={() => void setCompleted(task, occ.dateKey, !occ.completed)} />
        <ActionButton label={fromReminders ? "Delete Reminder" : "Delete Task"} destructive onPress={remove} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- routine

function RoutineDetail({ routineId, dateKey }: { routineId: string; dateKey: DateKey }) {
  const colors = useColors();
  const dark = useIsDark();
  const routine = useData((s) => s.routines.find((t) => t.id === routineId));
  const openEditor = useSheets((s) => s.openEditor);
  const closeDetail = useSheets((s) => s.closeDetail);
  const owner = usePerson(routine?.owner ?? "gooya");
  const occ = useMemo(() => {
    if (!routine) return null;
    const from = startOfDayMs(dateKey, routine.timezone) - DAY_MS;
    const to = startOfDayMs(addDaysKey(dateKey, 1), routine.timezone) + DAY_MS;
    return expandRoutine(routine, from, to).find((o) => o.dateKey === dateKey) ?? null;
  }, [routine, dateKey]);
  if (!routine || !occ) return <Missing what="routine" />;
  const color = routine.color ? colorHex(routine.color, dark) : colorHex(owner.color, dark);
  const ownerTimes = `${formatTime(occ.start, routine.timezone)} – ${formatTime(occ.end, routine.timezone)} ${tzAbbrev(routine.timezone, occ.start)}`;
  const localTimes = routine.timezone !== viewerTz ? `${formatTime(occ.start, viewerTz)} – ${formatTime(occ.end, viewerTz)} ${tzAbbrev(viewerTz, occ.start)} for you` : null;
  const edit = (dayOnly: boolean) => {
    openEditor({ kind: "routine", routine, dayOnly: dayOnly ? dateKey : undefined });
    router.replace("/sheet/edit");
  };
  const done = () => {
    closeDetail();
    router.back();
  };
  const remove = () => {
    const options = ["Delete This Day Only", "Delete All Future", "Delete Routine", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 3, destructiveButtonIndex: [0, 1, 2] }, (i) => {
      if (i === 0) void deleteRoutineDay(routine, dateKey).then(done);
      else if (i === 1) void endRoutineBefore(routine, dateKey).then(done);
      else if (i === 2) void deleteRoutine(routine.id).then(done);
    });
  };
  const startMin = minutesSinceMidnight(occ.start, viewerTz);
  const endMin = startMin + (occ.end - occ.start) / 60000;
  return (
    <View>
      <Top onEdit={() => edit(false)} />
      <View style={styles.barTitle}>
        <View style={[styles.titleBar, { backgroundColor: color }]} />
        <View style={styles.barTitleText}>
          <Text style={[styles.eventTitle, { color: colors.label }]}>
            {occ.icon} {occ.title}
          </Text>
          <Text style={[styles.whenText, { color: colors.label2 }]}>{longDate(dateKey)}</Text>
          <Text style={[styles.whenText, { color: colors.label2 }]}>{ownerTimes}</Text>
          {localTimes ? <Text style={[styles.small, { color: colors.label3 }]}>{localTimes}</Text> : null}
          <View style={styles.repeat}>
            <Icon name="repeat" size={17} color={colors.label2} />
            <Text style={[styles.whenText, { color: colors.label2, flex: 1 }]}>{describeRule(routine.rrule)}</Text>
          </View>
          {routine.overrides?.[dateKey] ? <Text style={[styles.small, { color: colors.orange }]}>Edited for this day only</Text> : null}
        </View>
      </View>
      <Fact label="Person">
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: colorHex(owner.color, dark) }]} />
          <Text style={[styles.factValue, { color: colors.label2 }]}>{owner.name}</Text>
        </View>
      </Fact>
      <MiniTimeline startMin={startMin} endMin={endMin}>
        {(hourH, firstHour) => (
          <View style={[styles.miniEvent, { top: ((startMin - firstHour * 60) / 60) * hourH, height: Math.max(18, ((endMin - startMin) / 60) * hourH), backgroundColor: mix(color, colors.bg3, dark ? 0.35 : 0.22) }]}>
            <View style={[styles.miniBar, { backgroundColor: color }]} />
            <Text numberOfLines={1} allowFontScaling={false} style={[styles.miniTitle, { color: dark ? mix(color, "#ffffff", 0.3) : mix(color, "#000000", 0.3) }]}>
              {occ.icon} {occ.title}
            </Text>
          </View>
        )}
      </MiniTimeline>
      <View style={styles.actions}>
        <ActionButton label="Edit This Day Only" onPress={() => edit(true)} />
        <ActionButton label="Delete…" destructive onPress={remove} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- event

function EventDetail({ eventId, dateKey }: { eventId: string; dateKey: DateKey }) {
  const colors = useColors();
  // An imported event, or one of GOOYA's own schedules (drawn as an event in its owner's colour).
  const imported = useData((s) => s.events.find((e) => e.id === eventId));
  const schedule = useData((s) => s.schedules.find((x) => x.id === eventId));
  const scheduleColor = usePersonColor(schedule?.owner ?? "gooya");
  const event = useMemo(() => imported ?? (schedule ? scheduleAsEvent(schedule, scheduleColor) : undefined), [imported, schedule, scheduleColor]);
  const calendarConfig = useData((s) => s.accounts.find((a) => a.id === event?.accountId)?.calendars?.[event?.calendarId ?? ""]);
  const me = useMe();
  const openEditor = useSheets((s) => s.openEditor);
  const owner = usePerson(event?.owner ?? "gooya");
  const occ = useMemo(() => {
    if (!event) return null;
    const from = startOfDayMs(dateKey, viewerTz) - DAY_MS;
    const to = startOfDayMs(addDaysKey(dateKey, 1), viewerTz) + DAY_MS;
    const all = expandEvent(event, from, to);
    return all.find((o) => o.dateKey === dateKey) ?? all[0] ?? null;
  }, [event, dateKey]);
  if (!event || !occ) return <Missing what="schedule" />;
  const color = event.color || colors.blue;
  const when = occ.allDay ? "all-day" : hasEndTime(occ) ? `${formatTime(occ.start, viewerTz)} – ${formatTime(occ.end, viewerTz)}` : formatTime(occ.start, viewerTz);
  const startMin = occ.allDay ? 0 : minutesSinceMidnight(occ.start, viewerTz);
  // A schedule without an end time takes half an hour's room, as in the day view.
  const endMin = startMin + (occ.end > occ.start ? (occ.end - occ.start) / 60000 : 30);
  // One occurrence can have its own place and notes.
  const ov = event.overrides?.[occ.dateKey];
  const location = ov?.location ?? event.location;
  const notes = plainNotes(ov?.notes ?? event.notes);
  const where = event.source === "google" ? "Google Calendar" : "iCloud";
  const edit = event.editable
    ? () => {
        openEditor({ kind: "schedule", event, eventOcc: occ });
        router.replace("/sheet/edit");
      }
    : undefined;
  return (
    <View>
      <Top onEdit={edit} />
      {event.pushError ? <Text style={[styles.pushError, { color: colors.red }]}>Your last change couldn’t be saved to {where}, so this is {where}’s version: {event.pushError}</Text> : null}
      <View style={styles.barTitle}>
        <View style={[styles.titleBar, { backgroundColor: color }]} />
        <View style={styles.barTitleText}>
          <Text style={[styles.eventTitle, { color: colors.label }]}>{occ.title}</Text>
          {location ? <Text style={[styles.whenText, { color: colors.label2 }]}>{location}</Text> : null}
          <Text style={[styles.whenText, { color: colors.label2 }]}>{longDate(occ.dateKey)}</Text>
          <Text style={[styles.whenText, { color: colors.label2 }]}>{when}</Text>
          {event.rrule ? (
            <View style={styles.repeat}>
              <Icon name="repeat" size={17} color={colors.label2} />
              <Text style={[styles.whenText, { color: colors.label2, flex: 1 }]}>{describeRule(event.rrule)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Fact label="Calendar">
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.factValue, { color: colors.label2 }]}>{event.calendarName}</Text>
          <SourceBadge source={event.source} size={14} color={colors.label2} />
        </View>
      </Fact>
      <Fact label="Person">{owner.name}</Fact>
      {notes ? (
        <Fact label="Notes">
          <Text selectable style={[styles.notes, { color: colors.label2 }]}>
            {notes}
          </Text>
        </Fact>
      ) : null}
      {!occ.allDay ? (
        <MiniTimeline startMin={startMin} endMin={endMin}>
          {(hourH, firstHour) => (
            <View style={[styles.miniEvent, { top: ((startMin - firstHour * 60) / 60) * hourH, height: Math.max(18, ((endMin - startMin) / 60) * hourH), backgroundColor: color }]}>
              <Text numberOfLines={1} allowFontScaling={false} style={[styles.miniTitle, { color: "#ffffff", paddingLeft: 8 }]}>
                {occ.title}
              </Text>
            </View>
          )}
        </MiniTimeline>
      ) : null}
      <Text style={[styles.foot, { color: colors.label3 }]}>
        {event.source === "gooya"
          ? "A schedule in GOOYA. When copying is on (Settings → Calendar integrations), it is in the GOOYA calendar of your Google or iCloud too, and changes made there come back."
          : event.dirty
            ? `Saving to ${where}…`
            : event.editable
              ? `Two-way with ${where}: change or delete it here or there, and the other one follows.`
              : event.owner !== me
                ? `From ${owner.name}’s ${where}.`
                : calendarConfig?.writable === false
                  ? `Imported from ${where}. This calendar can’t be changed from other apps.`
                  : `Imported from ${where}. Set this calendar to Two-way in Settings → Calendar integrations to change it here.`}
      </Text>
    </View>
  );
}

function Missing({ what }: { what: string }) {
  const colors = useColors();
  return (
    <View>
      <Top />
      <Text style={[styles.empty, { color: colors.label2 }]}>This {what} no longer exists.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 15, height: 74 },
  round: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  editPill: { height: 44, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  editText: { fontSize: 17 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 22, marginTop: 22 },
  taskTitle: { flex: 1, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  when: { paddingHorizontal: 30, marginTop: 10, gap: 2 },
  whenText: { fontSize: 17, lineHeight: 22 },
  small: { fontSize: 15, lineHeight: 20 },
  repeat: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  barTitle: { flexDirection: "row", marginTop: 22, paddingLeft: 16, paddingRight: 22 },
  titleBar: { width: 4, borderRadius: 2, marginRight: 12 },
  barTitleText: { flex: 1, gap: 2 },
  eventTitle: { fontSize: 27, fontWeight: "700", lineHeight: 33, marginBottom: 4 },
  fact: { paddingHorizontal: 30, marginTop: 20, gap: 3 },
  pushError: { paddingHorizontal: 22, marginTop: 8, fontSize: 15, lineHeight: 20 },
  factLabel: { fontSize: 15, fontWeight: "600" },
  factValue: { fontSize: 17, lineHeight: 22 },
  notes: { fontSize: 17, lineHeight: 22 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 11, height: 11, borderRadius: 5.5 },
  mini: { marginHorizontal: 16, marginTop: 24, borderRadius: 26, overflow: "hidden" },
  miniLabel: { position: "absolute", left: 0, width: 70, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingRight: 8 },
  miniNum: { fontSize: 17 },
  miniSuffix: { fontSize: 10.5, marginLeft: 2, marginTop: 3 },
  miniNoon: { fontSize: 14, fontWeight: "600" },
  miniLine: { position: "absolute", left: 78, right: 16, height: StyleSheet.hairlineWidth },
  miniBody: { position: "absolute", left: 78, right: 24, bottom: 0 },
  miniTask: { position: "absolute", left: 0, right: 0, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  miniEvent: { position: "absolute", left: 0, right: 0, borderRadius: 6, flexDirection: "row", alignItems: "flex-start", paddingTop: 3, overflow: "hidden" },
  miniBar: { width: 3, alignSelf: "stretch", borderRadius: 1.5, margin: 3, marginRight: 6 },
  miniTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  actions: { paddingHorizontal: 16, marginTop: 24, gap: 12 },
  action: { minHeight: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionText: { fontSize: 17 },
  foot: { paddingHorizontal: 30, marginTop: 24, fontSize: 13, lineHeight: 17 },
  empty: { paddingHorizontal: 24, paddingTop: 24, textAlign: "center", fontSize: 17 },
});
