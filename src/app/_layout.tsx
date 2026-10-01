import * as Notifications from "expo-notifications";
import { Stack, router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initAuth } from "@/lib/auth";
import { isMock } from "@/lib/mock";
import { useIsPad } from "@/lib/layout";
import { noteExternalOpen, useOpenView } from "@/lib/openView";
import { refreshPushToken, requestNotifications } from "@/lib/push";
import { useSheets } from "@/store/sheets";
import { useData } from "@/store/data";
import { setupProblem } from "@/lib/env";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import { useColors, useIsDark } from "@/theme";
import { Loading } from "@/components/Loading";
import { Problem } from "@/components/Problem";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const colors = useColors();
  /** A full-height page sheet (Apple's "New Event") and a short sheet that fits its content. */
  const page = { presentation: "modal" as const, contentStyle: { backgroundColor: colors.bg2 } };
  const small = { presentation: "formSheet" as const, sheetGrabberVisible: true, sheetCornerRadius: 30, contentStyle: { backgroundColor: colors.bg2 } };
  const dark = useIsDark();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const hydrated = usePrefs((s) => s.hydrated);
  const pathname = usePathname();
  const pad = useIsPad();
  // Settings → Opens In: today in the chosen view when GOOYA starts and after time away.
  useOpenView(status === "ready" && hydrated && !setupProblem, pathname, pad);
  // Once signed in: ask for notifications (once) and register this phone for the server's alerts.
  useEffect(() => {
    if (status !== "ready" || !me || isMock) return;
    void requestNotifications().then((granted) => {
      if (granted) void refreshPushToken(me);
    });
  }, [status, me]);
  // A tapped alert opens its task (the server puts taskId and dateKey in the push data).
  useEffect(() => {
    const open = (data: Record<string, unknown> | undefined) => {
      const taskId = typeof data?.taskId === "string" ? data.taskId : null;
      const dateKey = typeof data?.dateKey === "string" ? data.dateKey : "";
      if (!taskId) return;
      const task = useData.getState().tasks.find((t) => t.id === taskId);
      if (!task) return;
      noteExternalOpen();
      useSheets.getState().openEditor({ kind: "task", task });
      if (dateKey) router.push({ pathname: "/day/[date]", params: { date: dateKey } });
      router.push("/sheet/edit");
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data as Record<string, unknown>));
    void Notifications.getLastNotificationResponseAsync().then((r) => r && setTimeout(() => open(r.notification.request.content.data as Record<string, unknown>), 800));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!setupProblem) initAuth();
  }, []);
  useEffect(() => {
    if (status !== "loading" && hydrated) void SplashScreen.hideAsync().catch(() => undefined);
  }, [status, hydrated]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={dark ? "light" : "dark"} />
      {setupProblem ? (
        <Problem text={setupProblem} />
      ) : status === "loading" || !hydrated ? (
        <Loading />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={status !== "ready"}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
          <Stack.Protected guard={status === "ready"}>
            <Stack.Screen name="index" />
            <Stack.Screen name="year" />
            <Stack.Screen name="day/[date]" />
            <Stack.Screen name="lists/index" />
            <Stack.Screen name="lists/[id]" />
            <Stack.Screen name="search" options={{ presentation: "fullScreenModal", animation: "fade" }} />
            <Stack.Screen name="sheet/edit" options={{ ...page, gestureEnabled: true }} />
            <Stack.Screen name="sheet/listEdit" options={page} />
            <Stack.Screen name="settings" options={page} />
            <Stack.Screen name="categories" options={page} />
            <Stack.Screen name="integrations" options={page} />
            <Stack.Screen name="sheet/detail" options={page} />
            <Stack.Screen name="sheet/list" options={{ ...small, sheetAllowedDetents: [0.6, 1] }} />
            <Stack.Screen name="sheet/tags" options={{ ...small, sheetAllowedDetents: [0.55, 1] }} />
            <Stack.Screen name="calendars" options={page} />
            <Stack.Screen name="open" options={{ animation: "none" }} />
          </Stack.Protected>
        </Stack>
      )}
    </GestureHandlerRootView>
  );
}
