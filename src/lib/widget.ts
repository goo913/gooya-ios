import { ExtensionStorage } from "@bacons/apple-targets";
import { PEOPLE, type PersonKey } from "@shared/people";
import type { UserDoc } from "@shared/model";
import { buildWidgetFeed } from "@shared/widgetFeed";
import Constants from "expo-constants";
import { AppState } from "react-native";
import { useData } from "@/store/data";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import { isMock } from "./mock";
import { viewerTz } from "./useNow";

/**
 * The Home Screen widget (targets/widget, Swift) reads what the app writes into the App Group: the same feed the
 * widgetFeed Cloud Function serves (shared/widgetFeed.ts) and the person's widget token, with which the widget
 * refreshes itself from the server when the app has not run for a while.
 */
const appGroup: string | null = typeof Constants.expoConfig?.extra?.appGroup === "string" ? Constants.expoConfig.extra.appGroup : null;
const storage = appGroup ? new ExtensionStorage(appGroup) : null;

/** hidden: the calendars unticked on this phone (Calendars), which the widget leaves out as the app does. */
const KEYS = { feed: "feed", token: "token", stale: "stale", hidden: "hidden" } as const;

function fallbackUser(me: PersonKey): UserDoc {
  const def = PEOPLE[me];
  return { key: me, email: def.email, name: def.name, timezone: def.timezone, color: def.color, fcmTokens: [], settings: {} };
}

/** Writes the feed for the signed-in person and asks WidgetKit to show it. */
export function syncWidgetNow(): void {
  if (!storage) return;
  const me = useSession.getState().me;
  const { users, tasks, schedules, events, lists, loaded } = useData.getState();
  if (!me) return;
  if (!isMock && !(loaded.tasks && loaded.schedules && loaded.users)) return;
  const mine = users[me] ?? fallbackUser(me);
  // On this phone's clock, as the app shows days.
  const feed = buildWidgetFeed({ me: mine, users: Object.values(users).filter((u): u is UserDoc => !!u), tasks, schedules, events, lists, days: 31, tz: viewerTz });
  storage.set(KEYS.feed, JSON.stringify(feed));
  storage.set(KEYS.hidden, JSON.stringify(usePrefs.getState().hiddenCalendars));
  if (mine.widgetToken) storage.set(KEYS.token, mine.widgetToken);
  else storage.remove(KEYS.token);
  storage.remove(KEYS.stale);
  ExtensionStorage.reloadWidget();
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Syncs shortly after the last change (edits come in bursts; WidgetKit reloads are budgeted). */
export function syncWidgetSoon(delay = 1500): void {
  if (!storage) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncWidgetNow();
  }, delay);
}

let started = false;

/** Keeps the widget in step with the app's data for as long as the app runs. Called once the data listeners start. */
export function startWidgetSync(): void {
  if (started || !storage) return;
  started = true;
  useData.subscribe(() => syncWidgetSoon());
  usePrefs.subscribe((s, before) => {
    if (s.hiddenCalendars !== before.hiddenCalendars) syncWidgetSoon();
  });
  AppState.addEventListener("change", (state) => {
    if (state !== "active" && timer) {
      clearTimeout(timer);
      timer = null;
      syncWidgetNow();
    }
  });
  syncWidgetSoon(0);
}

/** After sign-out: the widget shows "Open GOOYA" instead of the last person's calendar. */
export function clearWidget(): void {
  if (!storage) return;
  if (timer) clearTimeout(timer);
  timer = null;
  storage.remove(KEYS.feed);
  storage.remove(KEYS.token);
  storage.remove(KEYS.stale);
  storage.remove(KEYS.hidden);
  ExtensionStorage.reloadWidget();
}

/** A push arrived with the app closed: the widget should fetch the feed from the server next time it draws. */
export function markWidgetStale(): void {
  if (!storage) return;
  storage.set(KEYS.stale, 1);
  ExtensionStorage.reloadWidget();
}
