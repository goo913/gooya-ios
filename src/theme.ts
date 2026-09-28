import { useColorScheme } from "react-native";

/**
 * Apple's system palette, as the web app used it (its light-dark() tokens), for the phone's light and dark
 * appearance. The appearance follows the person's choice in Settings (Dark by default): store/prefs.ts.
 */
const dark = {
  bg: "#000000",
  bg2: "#1c1c1e",
  bg3: "#2c2c2e",
  grouped: "#000000",
  grouped2: "#1c1c1e",
  label: "#ffffff",
  label2: "rgba(235,235,245,0.6)",
  label3: "rgba(235,235,245,0.3)",
  label4: "rgba(235,235,245,0.16)",
  separator: "rgba(84,84,88,0.65)",
  fill: "rgba(120,120,128,0.36)",
  fill2: "rgba(120,120,128,0.32)",
  fill3: "rgba(118,118,128,0.24)",
  fill4: "rgba(116,116,128,0.18)",
  blue: "#0091ff",
  red: "#ff4245",
  orange: "#ff9230",
  pink: "#ff375f",
  green: "#30d158",
  teal: "#40c8e0",
  indigo: "#5e5ce6",
  purple: "#bf5af2",
  yellow: "#ffd60a",
  gray: "#8e8e93",
  glassTint: "rgba(48,48,50,0.46)",
  glassRim: "rgba(255,255,255,0.14)",
};

const light: typeof dark = {
  bg: "#ffffff",
  bg2: "#f2f2f7",
  bg3: "#ffffff",
  grouped: "#f2f2f7",
  grouped2: "#ffffff",
  label: "#000000",
  label2: "rgba(60,60,67,0.6)",
  label3: "rgba(60,60,67,0.3)",
  label4: "rgba(60,60,67,0.18)",
  separator: "rgba(60,60,67,0.29)",
  fill: "rgba(120,120,128,0.2)",
  fill2: "rgba(120,120,128,0.16)",
  fill3: "rgba(118,118,128,0.12)",
  fill4: "rgba(116,116,128,0.08)",
  blue: "#0088ff",
  red: "#ff383c",
  orange: "#ff8d28",
  pink: "#ff2d55",
  green: "#34c759",
  teal: "#30b0c7",
  indigo: "#5856d6",
  purple: "#af52de",
  yellow: "#ffcc00",
  gray: "#8e8e93",
  glassTint: "rgba(255,255,255,0.78)",
  glassRim: "rgba(0,0,0,0.1)",
};

export type Colors = typeof dark;

export const useIsDark = (): boolean => useColorScheme() !== "light";

export function useColors(): Colors {
  return useIsDark() ? dark : light;
}

/** The pills' height and the chrome's standard measures, as on the web app. */
export const PILL_H = 45;
