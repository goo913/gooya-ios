import { getIdToken } from "@react-native-firebase/auth";
import { httpsCallable } from "@react-native-firebase/functions";
import type { SyncDirection } from "@shared/model";
import { otherPerson, type PersonKey } from "@shared/people";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { CheckRow } from "@/components/CheckRow";
import { DestructiveButton, Group, Row, Switch, TextRow } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { CloseButton, SheetBar } from "@/components/SheetHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { deleteAccount, newId, patchAccount, patchSettings, patchUser } from "@/lib/db";
import { env } from "@/lib/env";
import { auth, functions } from "@/lib/firebase";
import { isMock } from "@/lib/mock";
import { useMe, usePerson } from "@/lib/people";
import { setReminderListIncluded, setRemindersEnabled, syncReminders, useReminders } from "@/lib/reminders";
import { useData, type IntegrationAccount } from "@/store/data";
import { useColors } from "@/theme";

const DIRECTIONS: { value: SyncDirection; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "import", label: "Import" },
  { value: "both", label: "Two-way" },
];
/** Calendars GOOYA may not change (holidays, subscriptions, calendars shared for viewing) are only imported. */
const READ_ONLY_DIRECTIONS = DIRECTIONS.slice(0, 2);

/** Settings → Calendar integrations: Google, iCloud, the Reminders bridge, the subscription feed. */
export default function IntegrationsSheet() {
  const colors = useColors();
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const rem = useReminders();
  // The one device that syncs this person's reminders, when it is another one than this.
  const remindersDevice = mine.doc?.remindersDevice ?? null;
  const elsewhere = remindersDevice && remindersDevice.id !== rem.deviceId ? remindersDevice : null;
  const syncingHere = rem.enabled && !elsewhere;
  const accounts = useData((s) => s.accounts);
  const params = useLocalSearchParams<{ error?: string; integrations?: string }>();
  const [message, setMessage] = useState<string | null>(params.integrations === "google" ? (params.error ? `Google: ${params.error}` : "Google Calendar connected.") : null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appleEmail, setAppleEmail] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleError, setAppleError] = useState<string | null>(null);
  /** Bumped after a successful connection, so the password field starts empty again. */
  const [appleForm, setAppleForm] = useState(0);
  const token = mine.doc?.widgetToken ?? null;
  const google = accounts.filter((a) => a.source === "google");
  const apple = accounts.filter((a) => a.source === "apple");
  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };
  const copy = async (what: string, text: string) => {
    await Clipboard.setStringAsync(text);
    flash(what);
  };
  const ensureToken = async (): Promise<string> => {
    if (token) return token;
    const t = `${newId()}${newId()}`;
    await patchUser(me, { widgetToken: t });
    return t;
  };
  const connectGoogle = async () => {
    if (isMock) return setMessage("Demo mode: connections are simulated.");
    setBusy("google");
    setMessage(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("not signed in");
      const idToken = await getIdToken(user);
      const result = await WebBrowser.openAuthSessionAsync(`${env.functionsUrl}/googleAuthStart?token=${encodeURIComponent(idToken)}&app=1`, "gooya://integrations");
      if (result.type === "success") {
        const err = new URL(result.url).searchParams.get("error");
        setMessage(err ? `Google: ${err}` : "Google Calendar connected. Choose a direction for each calendar below.");
      }
    } catch (e) {
      setMessage(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const connectApple = async () => {
    if (isMock) return setAppleError("Demo mode: connections are simulated.");
    if (!appleEmail.trim() || !applePassword.trim()) return setAppleError("Enter your Apple Account email and an app-specific password (steps above).");
    setBusy("apple");
    setAppleError(null);
    try {
      await httpsCallable(functions, "appleConnect")({ email: appleEmail.trim(), password: applePassword });
      setApplePassword("");
      setAppleForm((n) => n + 1);
      setMessage("iCloud connected. Choose Import, Export or Two-way for each calendar below.");
    } catch (e) {
      // The server explains what went wrong in plain words (functions/src/integrations/apple.ts).
      setAppleError(String((e as Error).message ?? e).replace(/^\[?[\w/-]+\]?\s*/, ""));
    } finally {
      setBusy(null);
    }
  };
  const syncNow = async (accountId: string) => {
    if (isMock) return;
    setBusy(accountId);
    try {
      await httpsCallable(functions, "syncNow")({ accountId });
    } catch (e) {
      setMessage(`Sync failed: ${String((e as Error).message ?? e).replace(/^\[?[\w/-]+\]?\s*/, "")}`);
    } finally {
      setBusy(null);
    }
  };
  const feedUrl = useMemo(() => (token ? `${env.functionsUrl}/icsFeed?token=${token}` : ""), [token]);
  const webcal = feedUrl.replace(/^https:/, "webcal:");
  const copyIcon = (what: string) => (copied === what ? <Icon name="checkmark" size={16} color={colors.green} weight="bold" /> : <Icon name="doc.on.doc" size={16} color={colors.label2} />);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Integrations" left={<CloseButton onPress={() => router.back()} />} />
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {message ? (
          <View style={styles.group}>
            <Text style={[styles.message, { backgroundColor: colors.bg3, color: colors.label }]}>{message}</Text>
          </View>
        ) : null}

        <Group
          header="Google Calendar"
          footer="Import shows a calendar’s events in GOOYA. Two-way also lets you change, add and delete its events in GOOYA; the change is in Google within seconds, and changes made in Google come to GOOYA just as fast. Holiday and other read-only calendars can only be imported. The GOOYA calendar is a calendar GOOYA keeps in your Google account with your tasks and schedules: move, rename or delete one there and it changes in GOOYA too."
        >
          {google.map((a) => (
            <AccountRows key={a.id} account={a} me={me} busy={busy === a.id} onSync={() => void syncNow(a.id)} />
          ))}
          <Row label={google.length ? "Connect another Google account" : "Connect Google Calendar"} labelColor={colors.blue} onPress={() => void connectGoogle()}>
            {busy === "google" ? <Text style={[styles.small, { color: colors.label2 }]}>…</Text> : <Icon name="arrow.up.right" size={16} color={colors.label2} />}
          </Row>
        </Group>

        <Group
          header="Apple Calendar (iCloud)"
          footer="Import and Two-way work as for Google: changes made in GOOYA are in iCloud within seconds; changes made in Apple Calendar come to GOOYA within 5 minutes (iCloud does not tell other apps sooner). Your Apple Reminders are in Apple Calendar already, so the GOOYA calendar here holds only GOOYA’s own tasks and your schedules. Apple lets other apps into iCloud Calendar only with an app-specific password, never your Apple Account password; it is stored encrypted on GOOYA’s server and you can revoke it at account.apple.com at any time."
        >
          {apple.map((a) => (
            <AccountRows key={a.id} account={a} me={me} busy={busy === a.id} onSync={() => void syncNow(a.id)} />
          ))}
          <View style={styles.steps}>
            {[
              "Tap “Make an app-specific password” below and sign in to your Apple Account.",
              "Open Sign-In and Security → App-Specific Passwords → +, name it GOOYA, and tap Create.",
              "Copy the password Apple shows (16 letters like abcd-efgh-ijkl-mnop) and paste it here with your Apple Account email.",
            ].map((t, i) => (
              <Text key={i} style={[styles.step, { color: colors.label }]}>
                {i + 1}. {t}
              </Text>
            ))}
          </View>
          <Row label="Make an app-specific password" labelColor={colors.blue} onPress={() => void Linking.openURL("https://account.apple.com/account/manage/section/security")}>
            <Icon name="arrow.up.right" size={16} color={colors.label2} />
          </Row>
          <TextRow value={appleEmail} onChange={setAppleEmail} placeholder="Apple Account email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="username" />
          <TextRow key={`password-${appleForm}`} value={applePassword} onChange={setApplePassword} placeholder="App-specific password (abcd-efgh-ijkl-mnop)" secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="oneTimeCode" />
          <Row label={busy === "apple" ? "Connecting…" : "Connect iCloud"} labelColor={colors.blue} onPress={() => void connectApple()} />
          {appleError ? <Text style={[styles.error, { color: colors.red }]}>{appleError}</Text> : null}
        </Group>

        <Group header="Imported events" footer="When the same event arrives from both Apple and Google (same iCalUID, or same title + start + end), show it only once.">
          <Row label="Avoid duplicates">
            <Switch label="Avoid duplicates" value={mine.settings.avoidDuplicates} onChange={(v) => void patchSettings(me, { avoidDuplicates: v })} />
          </Row>
        </Group>

        <Group
          header="Apple Reminders"
          footer={`Two-way. Each of your Reminders lists is a category in GOOYA (the one of its name, or one made from it), which you and ${other.name} share, and each category your tasks are in is a list in your Reminders, with its name and color, so Apple Calendar shows your tasks in their category's color. Complete, rename, re-date, move or delete a reminder in GOOYA and it changes in Reminders; add a task in GOOYA and it is added to Reminders; rename or recolor a list in Reminders and its category follows. Apple keeps Reminders on your devices only, so this iPhone does the syncing: your changes in GOOYA are in Reminders within seconds, and changes made in Reminders come in when you open GOOYA, and at once while it is open. When ${other.name} changes one of your reminders, GOOYA wakes this iPhone to take it to Reminders; if iOS doesn't let it, it goes the next time GOOYA opens here. Only one of your devices syncs Reminders: the one where you turned this on last.`}
        >
          <Row label="Sync My Reminders">
            <Switch label="Sync my reminders" value={syncingHere} onChange={(v) => void setRemindersEnabled(v)} />
          </Row>
          {elsewhere ? (
            <Text style={[styles.error, { color: colors.label2, paddingTop: 10 }]}>
              Your reminders sync on your {elsewhere.name}. Turn Sync My Reminders on to sync them on this device instead.
            </Text>
          ) : null}
          {syncingHere ? (
            <Row label={rem.syncing ? "Syncing…" : "Sync Now"} labelColor={colors.blue} onPress={() => void syncReminders(true)}>
              {rem.lastSync ? (
                <Text style={[styles.small, { color: colors.label2 }]}>
                  {rem.lastCount} open · {new Date(rem.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
              ) : null}
            </Row>
          ) : null}
          {rem.access === "denied" ? <Row label="Allow Reminders in Settings" labelColor={colors.blue} onPress={() => void Linking.openSettings()} chevron /> : null}
          {rem.lastError && !elsewhere ? <Text style={[styles.error, { color: colors.red, paddingTop: 10 }]}>{rem.lastError}</Text> : null}
          {syncingHere && rem.sent ? (
            // What GOOYA last changed in Reminders, so a change made here can be checked there.
            <View style={styles.problems}>
              <Text style={[styles.small, { color: colors.label2 }]}>
                Changed in Reminders {new Date(rem.sent.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}:
              </Text>
              {rem.sent.lines.slice(0, 6).map((line, i) => (
                <Text key={i} style={[styles.small, { color: colors.label }]}>
                  {line}
                </Text>
              ))}
              {rem.sent.lines.length > 6 ? <Text style={[styles.small, { color: colors.label2 }]}>and {rem.sent.lines.length - 6} more</Text> : null}
            </View>
          ) : null}
          {syncingHere && rem.problems.length ? (
            <View style={styles.problems}>
              {rem.problems.map((p, i) => (
                <Text key={i} style={[styles.small, { color: colors.orange }]}>
                  {p}
                </Text>
              ))}
            </View>
          ) : null}
        </Group>

        {syncingHere && rem.lists.length ? (
          <Group header="Reminders lists" footer="The ticked lists are in GOOYA. Lists marked read-only are subscribed or shared with you for viewing: GOOYA shows them but can’t change them.">
            {rem.lists.map((l) => (
              <CheckRow
                key={l.id}
                color={l.color}
                checked={!rem.excluded.includes(l.id)}
                title={l.title}
                subtitle={[l.isDefault ? "Default list" : null, l.writable ? null : "Read-only", l.source || null].filter(Boolean).join(" · ") || undefined}
                onPress={() => setReminderListIncluded(l.id, rem.excluded.includes(l.id))}
              />
            ))}
          </Group>
        ) : null}

        <Group header="Subscription feed" footer="A private read-only calendar of your tasks and schedules. Subscribe from Apple Calendar or Google Calendar (From URL). Zero setup; works even if the two-way sync ever breaks.">
          <Row label="webcal:// URL" onPress={() => void ensureToken().then((t) => copy("feed", `webcal://${env.functionsUrl.replace("https://", "")}/icsFeed?token=${t}`))}>
            <Text numberOfLines={1} style={[styles.small, { color: colors.label2, flexShrink: 1 }]}>
              {token ? webcal.replace("webcal://", "") : "Tap to create"}
            </Text>
            {copyIcon("feed")}
          </Row>
          <Row label="Subscribe in Apple Calendar" onPress={() => void ensureToken().then((t) => Linking.openURL(`webcal://${env.functionsUrl.replace("https://", "")}/icsFeed?token=${t}`))} chevron />
        </Group>
        {isMock ? <Text style={[styles.demo, { color: colors.label3 }]}>Demo mode: connections are simulated.</Text> : null}
      </ScrollView>
    </View>
  );
}

function AccountRows({ account, me, busy, onSync }: { account: IntegrationAccount; me: PersonKey; busy: boolean; onSync: () => void }) {
  const colors = useColors();
  const calendars = Object.entries(account.calendars ?? {}).sort((a, b) => Number(!!b[1].primary) - Number(!!a[1].primary) || a[1].name.localeCompare(b[1].name));
  const status = account.status === "error" ? "Error" : account.lastSync ? `Synced ${new Date(account.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Connected";
  return (
    <>
      <View style={styles.account}>
        <SourceBadge source={account.source} size={16} color={colors.label} />
        <View style={styles.accountText}>
          <Text style={[styles.email, { color: colors.label }]}>{account.email}</Text>
          <Text style={[styles.small, { color: account.status === "error" ? colors.red : colors.label2 }]}>{status}</Text>
        </View>
      </View>
      {account.error ? <Text style={[styles.error, { color: colors.red }]}>{account.error}</Text> : null}
      {calendars.map(([calId, c]) => {
        const readOnly = c.writable === false;
        // Before the server knew a calendar was read-only, Two-way could be chosen for one: it works as Import.
        const direction: SyncDirection = readOnly && c.direction === "both" ? "import" : c.direction === "import" || c.direction === "both" ? c.direction : "off";
        return (
          <View key={calId} style={styles.calendar}>
            <View style={styles.inline}>
              <View style={[styles.dot, { backgroundColor: c.color }]} />
              <Text numberOfLines={1} style={[styles.calName, { color: colors.label }]}>
                {c.name}
              </Text>
              {c.primary ? <Text style={[styles.primary, { color: colors.label3 }]}>primary</Text> : null}
              {readOnly ? <Text style={[styles.primary, { color: colors.label3 }]}>read-only</Text> : null}
            </View>
            <Segmented<SyncDirection> options={readOnly ? READ_ONLY_DIRECTIONS : DIRECTIONS} value={direction} onChange={(d) => void patchAccount(me, account.id, { calendars: { [calId]: { direction: d } } })} />
          </View>
        );
      })}
      <Row label={account.source === "google" ? "Tasks in a GOOYA calendar" : "GOOYA tasks in a GOOYA calendar"}>
        <Switch label="Copy tasks to a GOOYA calendar" value={account.exportTasks === true} onChange={(v) => void patchAccount(me, account.id, { exportTasks: v })} />
      </Row>
      <Row label="Schedules in a GOOYA calendar">
        <Switch label="Copy schedules to a GOOYA calendar" value={account.exportSchedules === true} onChange={(v) => void patchAccount(me, account.id, { exportSchedules: v })} />
      </Row>
      <Row label={busy ? "Syncing…" : "Sync Now"} labelColor={colors.blue} onPress={busy ? undefined : onSync} />
      <DestructiveButton onPress={() => void deleteAccount(me, account.id)}>Disconnect {account.source === "google" ? "Google" : "iCloud"}</DestructiveButton>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 24, paddingBottom: 60, paddingTop: 4 },
  group: { paddingHorizontal: 16 },
  message: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, overflow: "hidden" },
  small: { fontSize: 13 },
  error: { paddingHorizontal: 16, paddingBottom: 12, fontSize: 13 },
  steps: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  problems: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  step: { fontSize: 15, lineHeight: 21 },
  demo: { paddingHorizontal: 32, fontSize: 12 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  email: { fontSize: 17 },
  account: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  accountText: { flex: 1, gap: 2 },
  calendar: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  calName: { fontSize: 15, flexShrink: 1 },
  primary: { fontSize: 12 },
});
