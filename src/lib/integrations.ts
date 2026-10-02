import { getIdToken } from "@react-native-firebase/auth";
import { httpsCallable } from "@react-native-firebase/functions";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { newId, patchUser } from "@/lib/db";
import { env } from "@/lib/env";
import { auth, functions } from "@/lib/firebase";
import { isMock } from "@/lib/mock";
import { useMe, usePerson } from "@/lib/people";
import { useData } from "@/store/data";

/** The server's errors start with their code ("[functions/internal] …"): the words after it are for people. */
const plain = (e: unknown) => String((e as Error).message ?? e).replace(/^\[?[\w/-]+\]?\s*/, "");

/**
 * Calendar integrations (Google, iCloud, the subscription feed): what Settings shows of them and does with them, on
 * the iPhone's Integrations sheet and the Mac's Settings → Accounts.
 */
export function useIntegrations(initialMessage: string | null = null) {
  const me = useMe();
  const mine = usePerson(me);
  const accounts = useData((s) => s.accounts);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appleEmail, setAppleEmail] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleError, setAppleError] = useState<string | null>(null);
  /** Bumped after a successful connection, so the password field starts empty again. */
  const [appleForm, setAppleForm] = useState(0);
  const token = mine.doc?.widgetToken ?? null;

  const copy = async (what: string, text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
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
      setAppleError(plain(e));
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
      setMessage(`Sync failed: ${plain(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const feedUrl = token ? `${env.functionsUrl}/icsFeed?token=${token}` : "";
  /** The feed's webcal:// address (made the first time it is asked for). */
  const webcal = async () => `webcal://${env.functionsUrl.replace("https://", "")}/icsFeed?token=${await ensureToken()}`;

  return {
    me,
    accounts,
    googleAccounts: accounts.filter((a) => a.source === "google"),
    appleAccounts: accounts.filter((a) => a.source === "apple"),
    message,
    setMessage,
    copied,
    copy,
    busy,
    connectGoogle,
    connectApple,
    syncNow,
    /** The iCloud connection's fields; `form` changes after a connection (the password field starts again). */
    appleSignIn: { email: appleEmail, setEmail: setAppleEmail, password: applePassword, setPassword: setApplePassword, error: appleError, form: appleForm },
    token,
    feedUrl,
    webcal,
  };
}
