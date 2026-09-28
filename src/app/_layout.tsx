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
          </Stack.Protected>
        </Stack>
      )}
    </GestureHandlerRootView>
  );
}
