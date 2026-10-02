import { ColorPicker, Host } from "@expo/ui/swift-ui";
import type { SyncDirection } from "@shared/model";
import { PEOPLE, otherPerson, type PersonKey } from "@shared/people";
import { Image } from "expo-image";
import type { SFSymbol } from "expo-symbols";
import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import { signOutUser } from "@/lib/auth";
import { deleteAccount, patchAccount, patchUser } from "@/lib/db";
import { tzAbbrev } from "@/lib/format";
import { useIntegrations } from "@/lib/integrations";
import { isMock } from "@/lib/mock";
import { useMe, usePerson } from "@/lib/people";
import { setReminderListIncluded, setRemindersEnabled, syncReminders, useReminders } from "@/lib/reminders";
import type { IntegrationAccount } from "@/store/data";
import { useSession } from "@/store/session";
import { useColors, useIsDark } from "@/theme";
import { closeSettings } from "../../../modules/gooya-mac";
import { Box, Checkbox, Field, Form, Note, Popup, PushButton, Row, text, text2, useSettingsColors } from "./controls";

export const ACCOUNTS_SIZE = { width: 620, height: 440 };

const COMMON_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Seoul", "Asia/Tokyo", "Europe/London", "Europe/Paris", "UTC"];
const DIRECTIONS: { value: SyncDirection; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "import", label: "Import" },
  { value: "both", label: "Two-way" },
];
/** Calendars GOOYA may not change (holidays, subscriptions, calendars shared for viewing) are only imported. */
const READ_ONLY_DIRECTIONS = DIRECTIONS.slice(0, 2);

type Kind = "gooya" | "google" | "apple" | "reminders" | "feed";
interface Item {
  id: string;
  kind: Kind;
  title: string;
  subtitle: string;
  account?: IntegrationAccount;
}

/**
 * Settings → Accounts, as Apple Calendar's: the accounts in a list (GOOYA itself, Google and iCloud calendars, Apple
 * Reminders, the subscription feed), the one chosen in a box beside it.
 */
export function Accounts() {
  const it = useIntegrations();
  const me = it.me;
  const user = useSession((s) => s.user);
  const rem = useReminders();
  const mine = usePerson(me);
  const remindersDevice = mine.doc?.remindersDevice ?? null;
  const elsewhere = remindersDevice && remindersDevice.id !== rem.deviceId ? remindersDevice : null;
  const [chosen, setChosen] = useState<{ id: string; kind: Kind }>({ id: "gooya", kind: "gooya" });
  const c = useSettingsColors();

  const items: Item[] = [
    { id: "gooya", kind: "gooya", title: "GOOYA", subtitle: user?.email ?? PEOPLE[me].email },
    ...(it.googleAccounts.length ? it.googleAccounts.map((a): Item => ({ id: `account:${a.id}`, kind: "google", title: "Google", subtitle: a.email, account: a })) : [{ id: "google", kind: "google" as const, title: "Google", subtitle: "Not connected" }]),
    ...(it.appleAccounts.length ? it.appleAccounts.map((a): Item => ({ id: `account:${a.id}`, kind: "apple", title: "iCloud", subtitle: a.email, account: a })) : [{ id: "apple", kind: "apple" as const, title: "iCloud", subtitle: "Not connected" }]),
    { id: "reminders", kind: "reminders", title: "Reminders", subtitle: rem.enabled && !elsewhere ? "On this Mac" : elsewhere ? `On ${elsewhere.name}` : "Off" },
    { id: "feed", kind: "feed", title: "Subscription", subtitle: "Calendar feed" },
  ];
  // An account just connected (or disconnected) takes the place of what was chosen.
  const item = items.find((i) => i.id === chosen.id) ?? items.find((i) => i.kind === chosen.kind) ?? items[0];
  const account = item.account;

  return (
    <View style={[styles.pane, ACCOUNTS_SIZE]}>
      <View style={[styles.list, { backgroundColor: c.list, borderColor: c.listRim }]}>
        <ScrollView>
          {items.map((i) => (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              accessibilityLabel={i.title}
              accessibilityHint={i.subtitle}
              accessibilityState={{ selected: i.id === item.id }}
              onPress={() => setChosen({ id: i.id, kind: i.kind })}
              style={[styles.item, i.id === item.id && { backgroundColor: c.selected }]}
            >
              <Tile kind={i.kind} />
              <View style={styles.itemText}>
                <Text numberOfLines={1} style={[styles.itemTitle, text]}>
                  {i.title}
                </Text>
                <Text numberOfLines={1} style={[styles.itemSubtitle, text2]}>
                  {i.subtitle}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Box style={styles.detail}>
        <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
          {it.message ? (
            <View style={[styles.message, { borderColor: c.boxRim, backgroundColor: c.list }]}>
              <Text style={[styles.messageText, text]}>{it.message}</Text>
            </View>
          ) : null}
          {item.kind === "gooya" ? (
            <GooyaDetail key="gooya" email={item.subtitle} />
          ) : account ? (
            <AccountDetail key={item.id} account={account} me={me} busy={it.busy === account.id} onSync={() => void it.syncNow(account.id)} onAnother={item.kind === "google" ? () => void it.connectGoogle() : undefined} />
          ) : item.kind === "google" ? (
            <View style={styles.connect}>
              <Note>Your Google calendars in GOOYA: import them, or change them here too (two-way). A change made in either is in the other within seconds.</Note>
              <PushButton title={it.busy === "google" ? "Connecting…" : "Connect Google Calendar…"} enabled={it.busy !== "google"} onPress={() => void it.connectGoogle()} />
            </View>
          ) : item.kind === "apple" ? (
            <ICloudSignIn it={it} />
          ) : item.kind === "reminders" ? (
            <RemindersDetail elsewhere={elsewhere?.name ?? null} />
          ) : (
            <FeedDetail it={it} />
          )}
          {isMock ? <Note>Demo mode: connections are simulated.</Note> : null}
        </ScrollView>
      </Box>
    </View>
  );
}

/** A list row's icon: a small white tile, as Apple's accounts have. */
function Tile({ kind }: { kind: Kind }) {
  const c = useSettingsColors();
  const colors = useColors();
  const symbol: Record<Exclude<Kind, "gooya" | "google">, [SFSymbol, string]> = {
    apple: ["icloud.fill", "#3b9cf5"],
    reminders: ["checklist", colors.orange],
    feed: ["dot.radiowaves.left.and.right", colors.gray],
  };
  return (
    <View style={[styles.tile, { backgroundColor: c.tile, borderColor: c.listRim }]}>
      {kind === "gooya" ? (
        <Image source={require("../../../assets/images/icon.png")} style={styles.appIcon} contentFit="cover" />
      ) : kind === "google" ? (
        <Text style={styles.g}>G</Text>
      ) : (
        <Icon name={symbol[kind][0]} size={17} color={symbol[kind][1]} />
      )}
    </View>
  );
}

/** You in GOOYA: name, colour and time zone (and the other person's, which they set), and signing out. */
function GooyaDetail({ email }: { email: string }) {
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const dark = useIsDark();
  const [name, setName] = useState(mine.name);
  const zones = Array.from(new Set([...COMMON_ZONES, mine.timezone]));
  const save = (patch: Record<string, unknown>) => void patchUser(me, patch);
  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== mine.name) save({ name: trimmed });
  };
  const signOut = () =>
    Alert.alert("Sign out of GOOYA?", "GOOYA on this Mac signs out. Your calendar stays as it is.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          closeSettings();
          void signOutUser();
        },
      },
    ]);
  return (
    <Form label={96} control={220}>
      <Row label="Name">
        <Field defaultValue={name} onChangeText={setName} onBlur={saveName} onSubmitEditing={saveName} style={{ width: 200 }} />
      </Row>
      <Row label="Color">
        <Host matchContents>
          <ColorPicker selection={dark ? mine.hexDark : mine.hexLight} supportsOpacity={false} onSelectionChange={(color) => save({ color: color.slice(0, 7) })} />
        </Host>
      </Row>
      <Row label="Time zone">
        <Popup options={zones.map((z) => ({ value: z, label: `${z.replace("_", " ")} (${tzAbbrev(z)})` }))} value={mine.timezone} onChange={(timezone) => save({ timezone })} />
      </Row>
      <Row label={other.name} note={`${other.name} sets their own name, color and time zone.`}>
        <View style={[styles.dot, { backgroundColor: dark ? other.hexDark : other.hexLight }]} />
        <Text style={[styles.value, text]}>
          {other.timezone.replace("_", " ")} ({tzAbbrev(other.timezone)})
        </Text>
      </Row>
      <Row label="Signed in as">
        <Text numberOfLines={1} style={[styles.value, text, { flexShrink: 1 }]}>
          {email}
        </Text>
      </Row>
      <Row>
        <PushButton title="Sign Out…" onPress={signOut} />
      </Row>
    </Form>
  );
}

function AccountDetail({ account, me, busy, onSync, onAnother }: { account: IntegrationAccount; me: PersonKey; busy: boolean; onSync: () => void; onAnother?: () => void }) {
  const colors = useColors();
  const calendars = Object.entries(account.calendars ?? {}).sort((a, b) => Number(!!b[1].primary) - Number(!!a[1].primary) || a[1].name.localeCompare(b[1].name));
  const status = account.status === "error" ? "Error" : account.lastSync ? `Synced at ${new Date(account.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Connected";
  const name = account.source === "google" ? "Google" : "iCloud";
  const disconnect = () =>
    Alert.alert(`Disconnect ${name}?`, `${account.email}’s calendars leave GOOYA. Nothing is deleted in ${name}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => void deleteAccount(me, account.id) },
    ]);
  return (
    <Form label={112} control={240}>
      <Row label="Account">
        <Text numberOfLines={1} style={[styles.value, text, { flexShrink: 1 }]}>
          {account.email}
        </Text>
      </Row>
      <Row label="Status" note={account.error ?? undefined}>
        <Text style={[styles.value, account.status === "error" ? { color: colors.red } : text]}>{status}</Text>
        <PushButton title={busy ? "Syncing…" : "Sync Now"} enabled={!busy} onPress={onSync} />
      </Row>
      {calendars.length ? (
        <Row label="Calendars" top={4}>
          <View style={styles.calendars}>
            {calendars.map(([calId, cal]) => {
              const readOnly = cal.writable === false;
              // Before the server knew a calendar was read-only, Two-way could be chosen for one: it works as Import.
              const direction: SyncDirection = readOnly && cal.direction === "both" ? "import" : cal.direction === "import" || cal.direction === "both" ? cal.direction : "off";
              return (
                <View key={calId} style={styles.calendar}>
                  <View style={[styles.dot, { backgroundColor: cal.color }]} />
                  <Text numberOfLines={1} style={[styles.value, text, styles.calName]}>
                    {cal.name}
                  </Text>
                  <Popup options={readOnly ? READ_ONLY_DIRECTIONS : DIRECTIONS} value={direction} width={96} onChange={(d) => void patchAccount(me, account.id, { calendars: { [calId]: { direction: d } } })} />
                </View>
              );
            })}
          </View>
        </Row>
      ) : null}
      <Row label={`Also in ${name}`} top={0} note="In a calendar named GOOYA there.">
        <View style={styles.checks}>
          <Checkbox title={account.source === "google" ? "Tasks" : "GOOYA’s tasks"} checked={account.exportTasks === true} onChange={(v) => void patchAccount(me, account.id, { exportTasks: v })} />
          <Checkbox title="Schedules" checked={account.exportSchedules === true} onChange={(v) => void patchAccount(me, account.id, { exportSchedules: v })} />
        </View>
      </Row>
      <Row>
        <PushButton title="Disconnect…" onPress={disconnect} />
        {onAnother ? <PushButton title="Add Another…" onPress={onAnother} /> : null}
      </Row>
    </Form>
  );
}

/** Connecting iCloud: Apple lets other apps into iCloud Calendar with an app-specific password only. */
function ICloudSignIn({ it }: { it: ReturnType<typeof useIntegrations> }) {
  const colors = useColors();
  const { appleSignIn: form } = it;
  return (
    <Form label={112} control={230}>
      <Row label="Apple Account">
        <Field defaultValue={form.email} onChangeText={form.setEmail} placeholder="name@icloud.com" keyboardType="email-address" autoCapitalize="none" textContentType="username" style={{ width: 210 }} />
      </Row>
      <Row label="Password" note="An app-specific password, never your Apple Account password: at account.apple.com, Sign-In and Security → App-Specific Passwords → +.">
        <Field key={`password-${form.form}`} defaultValue={form.password} onChangeText={form.setPassword} placeholder="abcd-efgh-ijkl-mnop" secureTextEntry autoCapitalize="none" textContentType="oneTimeCode" style={{ width: 210 }} />
      </Row>
      <Row>
        <PushButton title="Make a Password…" onPress={() => void Linking.openURL("https://account.apple.com/account/manage/section/security")} />
        <PushButton title={it.busy === "apple" ? "Connecting…" : "Connect"} enabled={it.busy !== "apple"} onPress={() => void it.connectApple()} />
      </Row>
      {form.error ? (
        <Row>
          <Text style={[styles.note, { color: colors.red }]}>{form.error}</Text>
        </Row>
      ) : null}
    </Form>
  );
}

function RemindersDetail({ elsewhere }: { elsewhere: string | null }) {
  const colors = useColors();
  const me = useMe();
  const other = usePerson(otherPerson(me));
  const rem = useReminders();
  const syncingHere = rem.enabled && !elsewhere;
  return (
    <Form label={70} control={290}>
      <Row note={elsewhere ? `Your reminders sync on your ${elsewhere}. Turn this on to sync them on this Mac instead.` : undefined}>
        <Checkbox title="Sync my reminders on this Mac" checked={syncingHere} onChange={(on) => void setRemindersEnabled(on)} />
      </Row>
      {syncingHere ? (
        <Row label="Status">
          <Text style={[styles.value, text]}>{rem.lastSync ? `${rem.lastCount} open · ${new Date(rem.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not yet"}</Text>
          <PushButton title={rem.syncing ? "Syncing…" : "Sync Now"} enabled={!rem.syncing} onPress={() => void syncReminders(true)} />
        </Row>
      ) : null}
      {rem.access === "denied" ? (
        <Row note="GOOYA was not allowed into Reminders.">
          <PushButton title="Open System Settings…" onPress={() => void Linking.openSettings()} />
        </Row>
      ) : null}
      {rem.lastError && !elsewhere ? (
        <Row>
          <Text style={[styles.note, { color: colors.red }]}>{rem.lastError}</Text>
        </Row>
      ) : null}
      {syncingHere && rem.lists.length ? (
        <Row label="Lists" top={0}>
          <View style={styles.checks}>
            {rem.lists.map((l) => (
              <Checkbox key={l.id} title={l.writable ? l.title : `${l.title} (read-only)`} checked={!rem.excluded.includes(l.id)} onChange={() => setReminderListIncluded(l.id, rem.excluded.includes(l.id))} />
            ))}
          </View>
        </Row>
      ) : null}
      {syncingHere && rem.problems.length ? (
        <Row>
          <Text style={[styles.note, { color: colors.orange }]}>{rem.problems.join("\n")}</Text>
        </Row>
      ) : null}
      <Row>
        <Note>Both ways: each Reminders list is a category in GOOYA, shared with {other.name}, and your tasks are in Reminders in their category’s list. One of your devices syncs them: the one where this was turned on last.</Note>
      </Row>
    </Form>
  );
}

function FeedDetail({ it }: { it: ReturnType<typeof useIntegrations> }) {
  const address = it.token ? it.feedUrl.replace(/^https:\/\//, "") : "Made when you copy it";
  return (
    <Form label={70} control={290}>
      <Row label="Address">
        <Text numberOfLines={1} style={[styles.value, text2, { flexShrink: 1 }]}>
          {address}
        </Text>
      </Row>
      <Row>
        <PushButton title={it.copied === "feed" ? "Copied" : "Copy Address"} onPress={() => void it.webcal().then((url) => it.copy("feed", url))} />
        <PushButton title="Subscribe in Calendar…" onPress={() => void it.webcal().then((url) => Linking.openURL(url))} />
      </Row>
      <Row>
        <Note>A private, read-only calendar of your tasks and schedules, for Apple Calendar or Google Calendar (From URL). It works even if syncing ever stops.</Note>
      </Row>
    </Form>
  );
}

const styles = StyleSheet.create({
  pane: { flexDirection: "row", gap: 10, padding: 20 },
  list: { width: 170, borderWidth: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, height: 44 },
  itemText: { flex: 1 },
  itemTitle: { fontSize: 13 },
  itemSubtitle: { fontSize: 11 },
  tile: { width: 30, height: 30, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  appIcon: { width: 30, height: 30 },
  g: { fontSize: 17, fontWeight: "700", color: "#4285f4" },
  detail: { flex: 1 },
  detailContent: { padding: 16, gap: 14 },
  connect: { gap: 12, alignItems: "flex-start" },
  message: { borderWidth: 1, borderRadius: 6, padding: 8 },
  messageText: { fontSize: 12 },
  value: { fontSize: 13 },
  note: { fontSize: 11, lineHeight: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  calendars: { gap: 6, width: "100%" },
  calendar: { flexDirection: "row", alignItems: "center", gap: 6 },
  calName: { flex: 1 },
  checks: { gap: 6 },
});
