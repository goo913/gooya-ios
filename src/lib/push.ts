import { arrayRemove, arrayUnion } from "@react-native-firebase/firestore";
import { getMessaging, getToken, isDeviceRegisteredForRemoteMessages, onTokenRefresh, registerDeviceForRemoteMessages } from "@react-native-firebase/messaging";
import type { PersonKey } from "@shared/people";
import * as Notifications from "expo-notifications";
import { patchUser } from "./db";
import { isMock } from "./mock";

// What the phone shows while GOOYA is open: pushes from the server as a banner, like any other notification.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const within = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

let stored: string | null = null;

/** This phone's FCM token, or null when the build cannot receive pushes (a personal team's, or the Simulator). */
export async function currentPushToken(): Promise<string | null> {
  const m = getMessaging();
  try {
    if (!isDeviceRegisteredForRemoteMessages(m)) await within(registerDeviceForRemoteMessages(m), 10_000);
    return (await within(getToken(m), 15_000)) || null;
  } catch {
    return null;
  }
}

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Puts this phone's token on users/{me}.fcmTokens, as the website did for browsers (functions/src/notify.ts reads it). */
export async function refreshPushToken(me: PersonKey): Promise<void> {
  if (isMock) return;
  if (!(await notificationsAllowed())) return;
  const token = await currentPushToken();
  if (!token) return;
  if (stored && stored !== token) await patchUser(me, { fcmTokens: arrayRemove(stored) }).catch(() => undefined);
  await patchUser(me, { fcmTokens: arrayUnion(token) }).catch(() => undefined);
  stored = token;
  onTokenRefresh(getMessaging(), (next) => {
    void patchUser(me, { fcmTokens: arrayUnion(next) }).catch(() => undefined);
    stored = next;
  });
}

export async function forgetPushToken(me: PersonKey): Promise<void> {
  if (isMock || !stored) return;
  await patchUser(me, { fcmTokens: arrayRemove(stored) }).catch(() => undefined);
  stored = null;
}
