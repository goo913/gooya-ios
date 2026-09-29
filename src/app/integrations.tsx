import { getIdToken } from "@react-native-firebase/auth";
import { httpsCallable } from "@react-native-firebase/functions";
import type { SyncDirection } from "@shared/model";
import type { PersonKey } from "@shared/people";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { DestructiveButton, Group, Row, Switch, TextRow } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { BarButton, SheetBar } from "@/components/SheetHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { deleteAccount, newId, patchAccount, patchSettings, patchUser } from "@/lib/db";
import { env } from "@/lib/env";
import { auth, functions } from "@/lib/firebase";
import { isMock } from "@/lib/mock";
import { useMe, usePerson } from "@/lib/people";
import { useData, type IntegrationAccount } from "@/store/data";
import { useColors } from "@/theme";

const DIRECTIONS: { value: SyncDirection; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "import", label: "Import" },
  { value: "export", label: "Export" },
  { value: "both", label: "Two-way" },
];

/** Settings → Calendar integrations: Google, iCloud, the Reminders bridge, the subscription feed. */
export default function IntegrationsSheet() {
  const colors = useColors();
  const me = useMe();
  const mine = usePerson(me);
  const accounts = useData((s) => s.accounts);
  const params = useLocalSearchParams<{ error?: string; integrations?: string }>();
  const [message, setMessage] = useState<string | null>(params.integrations === "google" ? (params.error ? `Google: ${params.error}` : "Google Calendar connected.") : null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appleEmail, setAppleEmail] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleError, setAppleError] = useState<string | null>(null);
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
    } finally {
      setBusy(null);
    }
  };
  const feedUrl = useMemo(() => (token ? `${env.functionsUrl}/icsFeed?token=${token}` : ""), [token]);
  const webcal = feedUrl.replace(/^https:/, "webcal:");
  const remindersUrl = `${env.functionsUrl}/remindersImport`;
  const copyIcon = (what: string) => (copied === what ? <Icon name="checkmark" size={16} color={colors.green} weight="bold" /> : <Icon name="doc.on.doc" size={16} color={colors.label2} />);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg2 }]}>
      <SheetBar title="Integrations" right={<BarButton onPress={() => router.back()}>Done</BarButton>} />
      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {message ? (
          <View style={styles.group}>
            <Text style={[styles.message, { backgroundColor: colors.bg3, color: colors.label }]}>{message}</Text>
          </View>
        ) : null}

        <Group header="Google Calendar" footer="Uses a separate Google consent step (calendar access). Import brings events into GOOYA; Export writes your tasks and schedules to a “GOOYA” calendar in your Google account; Two-way does both.">
          {google.map((a) => (
            <AccountRows key={a.id} account={a} me={me} busy={busy === a.id} onSync={() => void syncNow(a.id)} />
          ))}
          <Row label={google.length ? "Connect another Google account" : "Connect Google Calendar"} labelColor={colors.blue} onPress={() => void connectGoogle()}>
            {busy === "google" ? <Text style={[styles.small, { color: colors.label2 }]}>…</Text> : <Icon name="arrow.up.right" size={16} color={colors.label2} />}
          </Row>
        </Group>

        <Group
          header="Apple Calendar (iCloud)"
          footer="Apple lets other apps into iCloud Calendar only with an app-specific password, never your Apple Account password. It is stored encrypted on GOOYA's server and never shown again; you can revoke it at account.apple.com at any time."
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
          <TextRow value={applePassword} onChange={setApplePassword} placeholder="App-specific password (abcd-efgh-ijkl-mnop)" secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="oneTimeCode" />
          <Row label={busy === "apple" ? "Connecting…" : "Connect iCloud"} labelColor={colors.blue} onPress={() => void connectApple()} />
          {appleError ? <Text style={[styles.error, { color: colors.red }]}>{appleError}</Text> : null}
        </Group>

        <Group header="Imported events" footer="When the same event arrives from both Apple and Google (same iCalUID, or same title + start + end), show it only once.">
          <Row label="Avoid duplicates">
            <Switch label="Avoid duplicates" value={mine.settings.avoidDuplicates} onChange={(v) => void patchSettings(me, { avoidDuplicates: v })} />
          </Row>
        </Group>

        <Group header="Apple Reminders" footer="Apple has no server API for Reminders, so an iOS Shortcut sends them to GOOYA (one-way). Imported reminders land in the “Apple Reminders” list.">
          <View style={styles.steps}>
            {[
              "Open Shortcuts → + and name it “GOOYA Reminders”.",
              "Add “Find Reminders”: filter Is Completed is false.",
              "Add “Repeat with Each” → inside, “Get Details of Reminders” (Title, Notes, Due Date, Is Completed, List, Priority, Is Flagged, URL) and build a Dictionary with keys id, title, notes, dueDate, completed, list, priority, flagged, url.",
              "After the loop, “Get Contents of URL”: the endpoint below, Method POST, Request Body JSON with token = your token, full = true, reminders = the list of dictionaries.",
              "In Automation, add Time of Day automations (e.g. 8:00, 13:00, 19:00) that run this shortcut, with Run Immediately on.",
            ].map((t, i) => (
              <Text key={i} style={[styles.step, { color: colors.label }]}>
                {i + 1}. {t}
              </Text>
            ))}
          </View>
          <Row label="Endpoint URL" onPress={() => void copy("endpoint", remindersUrl)}>
            <Text numberOfLines={1} style={[styles.small, { color: colors.label2, flexShrink: 1 }]}>
              {remindersUrl.replace("https://", "")}
            </Text>
            {copyIcon("endpoint")}
          </Row>
          <Row label="Token" onPress={() => void ensureToken().then((t) => copy("token", t))}>
            <Text style={[styles.small, { color: colors.label2 }]}>{token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "Tap to create"}</Text>
            {copyIcon("token")}
          </Row>
        </Group>

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
      <Row
        label={
          <View style={styles.inline}>
            <SourceBadge source={account.source} size={16} color={colors.label} />
            <Text style={[styles.email, { color: colors.label }]}>{account.email}</Text>
          </View>
        }
      >
        <Text style={[styles.small, { color: account.status === "error" ? colors.red : colors.label2 }]}>{status}</Text>
      </Row>
      {account.error ? <Text style={[styles.error, { color: colors.red }]}>{account.error}</Text> : null}
      {calendars.map(([calId, c]) => (
        <View key={calId} style={styles.calendar}>
          <View style={styles.inline}>
            <View style={[styles.dot, { backgroundColor: c.color }]} />
            <Text numberOfLines={1} style={[styles.calName, { color: colors.label }]}>
              {c.name}
            </Text>
            {c.primary ? <Text style={[styles.primary, { color: colors.label3 }]}>primary</Text> : null}
          </View>
          <Segmented<SyncDirection> options={DIRECTIONS} value={c.direction} onChange={(d) => void patchAccount(me, account.id, { calendars: { [calId]: { direction: d } } })} />
        </View>
      ))}
      <Row label="Export tasks">
        <Switch label="Export tasks" value={account.exportTasks !== false} onChange={(v) => void patchAccount(me, account.id, { exportTasks: v })} />
      </Row>
      <Row label="Export schedules">
        <Switch label="Export schedules" value={account.exportSchedules !== false} onChange={(v) => void patchAccount(me, account.id, { exportSchedules: v })} />
      </Row>
      <Row label="Sync now" labelColor={colors.blue} onPress={onSync}>
        {busy ? <Text style={[styles.small, { color: colors.label2 }]}>Syncing…</Text> : null}
      </Row>
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
  step: { fontSize: 15, lineHeight: 21 },
  demo: { paddingHorizontal: 32, fontSize: 12 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  email: { fontSize: 17 },
  calendar: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  calName: { fontSize: 15, flexShrink: 1 },
  primary: { fontSize: 12 },
});
