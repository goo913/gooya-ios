import { PlatformColor, StyleSheet, Text, View } from "react-native";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import { setSettingsSize, type SettingsTab } from "../../../modules/gooya-mac";
import { ACCOUNTS_SIZE, Accounts } from "./Accounts";
import { Advanced } from "./Advanced";
import { Alerts } from "./Alerts";
import { Note, Section, text } from "./controls";
import { General } from "./General";

const TABS: SettingsTab[] = ["general", "accounts", "alerts", "advanced"];
/** Each tab's width (Apple's Settings: 537 points, wider where a tab needs it); its height is its content's. */
const WIDTHS: Record<SettingsTab, number> = { general: 537, accounts: ACCOUNTS_SIZE.width, alerts: 537, advanced: 537 };

/**
 * The Settings window's content (a window of its own on the Mac: modules/gooya-mac, GooyaMacSettings), registered as
 * "GooyaSettings" (index.ts). The window shows `tab` (its toolbar's choice) and takes the size of what this lays out.
 */
export default function SettingsWindow({ tab }: { tab?: string }) {
  const shown = TABS.includes(tab as SettingsTab) ? (tab as SettingsTab) : "general";
  const ready = useSession((s) => s.status === "ready");
  const hydrated = usePrefs((s) => s.hydrated);
  const width = WIDTHS[shown];
  return (
    <View style={[styles.fill, { backgroundColor: PlatformColor("systemBackgroundColor") }]}>
      {/* Laid out again for each tab, so the window always hears its size. */}
      <View key={shown} style={{ width }} onLayout={(e) => setSettingsSize(shown, width, e.nativeEvent.layout.height)}>
        {/* The line under the toolbar, as Calendar's Settings has (the window's own doesn't show in a Mac Catalyst app). */}
        <View style={[styles.line, { backgroundColor: PlatformColor("separatorColor") }]} />
        {!ready || !hydrated ? (
          <Section>
            <Text style={[styles.title, text]}>Sign in to GOOYA first.</Text>
            <Note>Its settings are here once you have signed in, in GOOYA’s window.</Note>
          </Section>
        ) : shown === "general" ? (
          <General />
        ) : shown === "accounts" ? (
          <Accounts />
        ) : shown === "alerts" ? (
          <Alerts />
        ) : (
          <Advanced />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  line: { height: StyleSheet.hairlineWidth },
  title: { fontSize: 13 },
});
