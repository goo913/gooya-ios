import { onAuthStateChanged, signOut } from "@react-native-firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "@react-native-firebase/firestore";
import { PEOPLE, personForEmail, type PersonKey } from "@shared/people";
import { useSession, type AuthUser } from "@/store/session";
import { newId, startData } from "./db";
import { auth, db } from "./firebase";
import { signInWithGoogle, signOutOfGoogle } from "./googleSignIn";
import { isMock, mockMe } from "./mock";
import { refreshPushToken } from "./push";
import { clearWidget } from "./widget";

export async function signIn(): Promise<void> {
  const session = useSession.getState();
  session.setError(null);
  session.setSigningIn(true);
  try {
    const done = await signInWithGoogle();
    if (!done) session.setSigningIn(false);
  } catch (e) {
    session.setError(describeError(e));
  }
}

export async function signOutUser(): Promise<void> {
  clearWidget();
  await signOutOfGoogle();
  await signOut(auth);
}

function describeError(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const code = String((e as { code: unknown }).code);
    if (/cancel|SIGN_IN_CANCELLED|-5/i.test(code)) return "";
    return code.replace("auth/", "").replace(/[-_]/g, " ").toLowerCase();
  }
  return e instanceof Error ? e.message : "Sign-in failed";
}

/** The token the widget, the subscription feed and the Reminders bridge identify this person with (users/{me}.widgetToken). */
const newWidgetToken = () => `${newId()}${newId()}`;

/** Create or refresh users/{personKey}. Never overwrites user-edited fields; gives the person a widget token once. */
async function ensureUserDoc(me: PersonKey, user: AuthUser): Promise<void> {
  const ref = doc(db, "users", me);
  const def = PEOPLE[me];
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        key: me, uid: user.uid, email: def.email, name: def.name, timezone: def.timezone, color: def.color,
        fcmTokens: [], settings: {}, widgetToken: newWidgetToken(), createdAt: serverTimestamp(), lastSeenAt: serverTimestamp(),
      });
    } else {
      const token = snap.data()?.widgetToken;
      await updateDoc(ref, { uid: user.uid, email: def.email, lastSeenAt: serverTimestamp(), ...(typeof token === "string" && token ? {} : { widgetToken: newWidgetToken() }) });
    }
  } catch {
    await setDoc(ref, { key: me, uid: user.uid, email: def.email, lastSeenAt: serverTimestamp() }, { merge: true });
  }
}

let started = false;

/** Wire Firebase Auth into the session store. Call once at startup. */
export function initAuth(): void {
  if (started) return;
  started = true;
  if (isMock) {
    useSession.getState().setReady(null, mockMe);
    startData();
    return;
  }
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      useSession.getState().setSignedOut();
      return;
    }
    const person = personForEmail(user.email);
    if (!person) {
      useSession.getState().setUnauthorized(user.email ?? "");
      void signOutUser();
      return;
    }
    useSession.getState().setReady(user, person.key);
    startData();
    void ensureUserDoc(person.key, user);
    void refreshPushToken(person.key);
  });
}
