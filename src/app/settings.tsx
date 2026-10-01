import { ColorPicker, Host, Slider } from "@expo/ui/swift-ui";
import { PEOPLE, otherPerson } from "@shared/people";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DestructiveButton, Group, Row, Switch, ValueRow, pickOption } from "@/components/Form";
import { Segmented } from "@/components/Segmented";
import { CloseButton, SheetBar } from "@/components/SheetHeader";
import { EARLY_REMINDERS } from "@/lib/alerts";
import { signOutUser } from "@/lib/auth";
import { patchSettings, patchUser } from "@/lib/db";
import { env } from "@/lib/env";
import { tzAbbrev } from "@/lib/format";
import { useIsPad } from "@/lib/layout";
import { OPEN_VIEWS, resolveOpenView } from "@/lib/openView";
import { isMac, openAtLogin, setOpenAtLogin } from "../../modules/gooya-mac";
import { useMe, usePerson } from "@/lib/people";
import { forgetPushToken, notificationsAllowed, refreshPushToken, requestNotifications } from "@/lib/push";
import { DEFAULT_HOUR_HEIGHT, usePrefs, type AppearancePref, type OpenView } from "@/store/prefs";
import { useSession } from "@/store/session";
import { useColors, useIsDark } from "@/theme";

const COMMON_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Seoul", "Asia/Tokyo", "Europe/London", "Europe/Paris", "UTC"];

export default function SettingsSheet() {
  const colors = useColors();
  const dark = useIsDark();
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const user = useSession((s) => s.user);
  const [name, setName] = useState(mine.name);
  const [push, setPush] = useState<boolean | null>(null);
  const [dragIntensity, setDragIntensity] = useState<number | null>(null);
  const setHourHeight = usePrefs((s) => s.setHourHeight);
  const appearance = usePrefs((s) => s.appearance);
  const setAppearance = usePrefs((s) => s.setAppearance);
  const routinesInDay = usePrefs((s) => s.routinesInDay);
  const routinesInWeek = usePrefs((s) => s.routinesInWeek);
  const setRoutinesInDay = usePrefs((s) => s.setRoutinesInDay);
  const setRoutinesInWeek = usePrefs((s) => s.setRoutinesInWeek);
  const openView = usePrefs((s) => s.openView);
  const setOpenView = usePrefs((s) => s.setOpenView);
  const menuBarAgenda = usePrefs((s) => s.menuBarAgenda);
  const setMenuBarAgenda = usePrefs((s) => s.setMenuBarAgenda);
  const [atLogin, setAtLogin] = useState(openAtLogin);
  // The week view is the iPad's (a narrow iPad window has the iPhone's screens).
  const pad = useIsPad();
  const device = isMac ? "Mac" : pad ? "iPad" : "iPhone";
  useEffect(() => {
    void notificationsAllowed().then(setPush);
  }, []);
  const zones = Array.from(new Set([...COMMON_ZONES, mine.timezone]));
  const save = (patch: Record<string, unknown>) => void patchUser(me, patch);
  const saveSetting = (key: string, value: unknown) => void patchSettings(me, { [key]: value });
  const intensity = dragIntensity ?? Math.round((mine.settings.routineIntensity ?? (dark ? 0.5 : 0.35)) * 100);
  const togglePush = async (on: boolean) => {
    if (on) {
      const granted = await requestNotifications();
      setPush(granted);
      if (granted) await refreshPushToken(me);
      else void Linking.openSettings();
    } else {
      await forgetPushToken(me);
      setPush(false);
    }
  };
  const alertLabel = (v: number | null) => EARLY_REMINDERS.find((o) => o.value === v)?.label ?? "None";

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Settings" left={<CloseButton onPress={() => router.back()} />} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Group header="Me" footer={`Signed in as ${user?.email ?? PEOPLE[me].email}`}>
          <Row label="Name">
            <TextInput defaultValue={name} onChangeText={setName} onBlur={() => name.trim() && name.trim() !== mine.name && save({ name: name.trim() })} style={[styles.input, { color: colors.label }]} textAlign="right" />
          </Row>
          <ValueRow label="Time Zone" value={`${mine.timezone.replace("_", " ")} (${tzAbbrev(mine.timezone)})`} options={zones.map((z) => `${z.replace("_", " ")} (${tzAbbrev(z)})`)} onPick={(_, i) => save({ timezone: zones[i] })} title="Time Zone" />
          <Row label="Color" accessibilityLabel="My color">
            <View style={styles.colorWell}>
              <Host matchContents>
                <ColorPicker selection={dark ? mine.hexDark : mine.hexLight} supportsOpacity={false} onSelectionChange={(c) => save({ color: c.slice(0, 7) })} />
              </Host>
            </View>
          </Row>
        </Group>

        <Group header="Appearance" footer={`Remembered on this ${device}. Dark is the default.`}>
          <Row label="Theme">
            <Segmented<AppearancePref>
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
              ]}
              value={appearance}
              onChange={setAppearance}
              style={{ width: 220 }}
            />
          </Row>
        </Group>

        <Group
          header="Default View"
          footer={`GOOYA opens on today in this view: when it starts, when you come back after 15 minutes away, and from the widget (a day tapped in the widget opens that day). Remembered on this ${device}.`}
        >
          <Row label="Opens In">
            <Segmented<OpenView>
              options={OPEN_VIEWS.filter((o) => pad || !o.pad).map(({ value, label }) => ({ value, label }))}
              value={resolveOpenView(openView, pad)}
              onChange={setOpenView}
              style={{ width: pad ? 220 : 150 }}
            />
          </Row>
        </Group>

        {isMac ? (
          <Group header="Mac" footer="GOOYA starts when you log in to this Mac, and its icon in the menu bar lists what is on today and tomorrow for both of you: choose one to see it.">
            <Row label="Open at Login">
              <Switch label="Open at Login" value={atLogin} onChange={(on) => void setOpenAtLogin(on).then(setAtLogin)} />
            </Row>
            <Row label="Show in Menu Bar">
              <Switch label="Show in Menu Bar" value={menuBarAgenda} onChange={setMenuBarAgenda} />
            </Row>
          </Group>
        ) : null}

        <Group header={other.name} footer={`${other.name} sets their own name, color and time zone.`}>
          <Row label="Color">
            <View style={[styles.swatch, { backgroundColor: dark ? other.hexDark : other.hexLight }]} />
          </Row>
          <Row label="Time Zone">
            <Text style={[styles.value, { color: colors.label2 }]}>
              {other.timezone.replace("_", " ")} ({tzAbbrev(other.timezone)})
            </Text>
          </Row>
        </Group>

        <Group
          header="Timeline"
          footer={`Routine intensity sets how strongly Work, Sleep and other routines are filled in. Showing routines in the day${pad ? " and week views" : " view"} is remembered on this ${device}. Shows ${other.name}’s local hours next to yours when the second gutter is on.`}
        >
          <View style={styles.sliderBlock}>
            <View style={styles.sliderHead}>
              <Text style={[styles.sliderLabel, { color: colors.label }]}>Routine intensity</Text>
              <Text style={[styles.sliderLabel, { color: colors.label2 }]}>{intensity}%</Text>
            </View>
            <View style={styles.sliderRow}>
              <Text style={[styles.sliderEnd, { color: colors.label2 }]}>Subtle</Text>
              <Host style={{ flex: 1, height: 32 }}>
                <Slider
                  value={intensity}
                  min={15}
                  max={85}
                  step={5}
                  onValueChange={(v) => setDragIntensity(Math.round(v))}
                  onEditingChanged={(editing) => {
                    if (!editing && dragIntensity != null) {
                      saveSetting("routineIntensity", dragIntensity / 100);
                      setDragIntensity(null);
                    }
                  }}
                />
              </Host>
              <Text style={[styles.sliderEnd, { color: colors.label2 }]}>Bold</Text>
            </View>
          </View>
          <Row label="Routines in Day View">
            <Switch label="Routines in Day View" value={routinesInDay} onChange={setRoutinesInDay} />
          </Row>
          {pad ? (
            <Row label="Routines in Week View">
              <Switch label="Routines in Week View" value={routinesInWeek} onChange={setRoutinesInWeek} />
            </Row>
          ) : null}
          <Row label="Second time gutter">
            <Switch label="Second time gutter" value={mine.settings.secondGutter} onChange={(v) => saveSetting("secondGutter", v)} />
          </Row>
          <Row label="Reset zoom" onPress={() => setHourHeight(DEFAULT_HOUR_HEIGHT)} chevron />
        </Group>

        <Group header="Categories" footer={`Shared with ${other.name}. Each has a color: a task's circle and a schedule's color.`}>
          <Row label="Categories" onPress={() => router.push("/categories")} chevron />
        </Group>

        <Group header="Tasks" footer="When off, completed tasks are hidden in the month, timeline, lists, search and the widget (the Completed list and the search filter still show them).">
          <Row label="Show Completed Tasks">
            <Switch label="Show Completed Tasks" value={mine.settings.showCompleted} onChange={(v) => saveSetting("showCompleted", v)} />
          </Row>
        </Group>

        <Group header="Schedules" footer="When off, schedules and calendar events that have ended are hidden in the month, day and list views and the widget (search still finds them).">
          <Row label="Show Past Schedules">
            <Switch label="Show Past Schedules" value={mine.settings.showPastSchedules} onChange={(v) => saveSetting("showPastSchedules", v)} />
          </Row>
        </Group>

        <Group header="Reminders" footer="Tasks alert at their due time (9:00 AM for date-only tasks). New tasks get this early reminder by default.">
          <ValueRow label="Default early reminder" value={alertLabel(mine.settings.defaultAlertTimed)} options={EARLY_REMINDERS.map((o) => o.label)} onPick={(_, i) => saveSetting("defaultAlertTimed", EARLY_REMINDERS[i].value)} title="Default early reminder" />
        </Group>

        <Group header="Notifications" footer={env.demo ? "Demo mode: no notifications." : `Alerts and the other person's additions arrive as notifications on this ${device}.`}>
          <Row label="Notifications">
            <Text style={[styles.small, { color: colors.label2 }]}>{push === null ? "" : push ? "On" : "Off"}</Text>
            <Switch label="Notifications" value={!!push} onChange={(v) => void togglePush(v)} disabled={env.demo} />
          </Row>
          <Row label={`When ${other.name} adds to my calendar`}>
            <Switch label="Notify on additions" value={mine.settings.notifyOnOtherAdds} onChange={(v) => saveSetting("notifyOnOtherAdds", v)} />
          </Row>
        </Group>

        <Group header="Integrations" footer="Google Calendar, Apple Calendar (iCloud), the Apple Reminders bridge and a subscription feed.">
          <Row label="Calendar integrations" onPress={() => router.push("/integrations")} chevron />
        </Group>

        <Group header="Home Screen widget" footer={`Tasks, schedules and your calendars' events (never routines) for both of you, in three sizes and on the Lock Screen. The large one shows two weeks and the list by default, or the month. It follows what you change here, and tapping a day opens it in GOOYA.`}>
          <Row
            label="How to add it"
            onPress={() =>
              Alert.alert(
                "Adding the widget",
                `1. Touch and hold an empty spot on the Home Screen.\n2. Tap Edit at the top left, then Add Widget.\n3. Search for GOOYA, pick a size and tap Add Widget.\n\nTouch and hold the widget, then Edit Widget:\n• Show: both of you, only you or only ${other.name}.\n• Layout (large size): Two Weeks & List, Month & List, or Month.\n• Appearance: System, or always Light or Dark, whatever the iPhone's mode.`,
              )
            }
            chevron
          />
        </Group>

        <DestructiveButton
          onPress={() =>
            pickOption(["Sign Out"], null, () => {
              router.back();
              void signOutUser();
            })
          }
        >
          Sign Out
        </DestructiveButton>
        <Text style={[styles.version, { color: colors.label3 }]}>
          GOOYA {env.version} ({env.build})
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 24, paddingBottom: 60, paddingTop: 4 },
  input: { flex: 1, fontSize: 17, paddingVertical: 10 },
  value: { fontSize: 17 },
  small: { fontSize: 15 },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  colorWell: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  sliderBlock: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  sliderHead: { flexDirection: "row", justifyContent: "space-between" },
  sliderLabel: { fontSize: 15 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sliderEnd: { fontSize: 13 },
  version: { textAlign: "center", fontSize: 12 },
});
