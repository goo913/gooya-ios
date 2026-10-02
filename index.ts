// Expo Router's entry. The background push handler is registered before the app, as a push may start it
// in the background (src/lib/pushBackground.ts).
import "./src/lib/pushBackground";
import "expo-router/entry";
import { AppRegistry } from "react-native";
import SettingsWindow from "./src/mac/settings/SettingsWindow";
import { isMac } from "./modules/gooya-mac";

// The Mac's Settings window: a window of its own, with React Native in it (modules/gooya-mac, GooyaMacSettings).
if (isMac) AppRegistry.registerComponent("GooyaSettings", () => SettingsWindow);
