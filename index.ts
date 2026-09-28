// Expo Router's entry. The background push handler is registered before the app, as a push may start it
// in the background (src/lib/pushBackground.ts).
import "./src/lib/pushBackground";
import "expo-router/entry";
