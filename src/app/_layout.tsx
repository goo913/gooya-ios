import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initAuth } from "@/lib/auth";
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
  const hydrated = usePrefs((s) => s.hydrated);
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
            <Stack.Screen name="integrations" options={page} />
            <Stack.Screen name="sheet/detail" options={{ ...small, sheetAllowedDetents: "fitToContents" }} />
            <Stack.Screen name="sheet/list" options={{ ...small, sheetAllowedDetents: [0.6, 1] }} />
            <Stack.Screen name="sheet/tags" options={{ ...small, sheetAllowedDetents: [0.55, 1] }} />
            <Stack.Screen name="calendars" options={{ ...small, sheetAllowedDetents: "fitToContents" }} />
          </Stack.Protected>
        </Stack>
      )}
    </GestureHandlerRootView>
  );
}
