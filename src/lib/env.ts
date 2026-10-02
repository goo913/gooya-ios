import Constants from "expo-constants";
import type { PersonKey } from "@shared/people";

/**
 * Demo mode (EXPO_PUBLIC_DEMO=1 when the development server starts): in-memory sample data, no sign-in and no
 * Firestore, so the app can be exercised on the iPhone Simulator, which has no Google account. A phone build
 * (npm run iphone) never runs in demo mode.
 */
const demo = process.env.EXPO_PUBLIC_DEMO === "1";

export const env = {
  demo,
  demoMe: (process.env.EXPO_PUBLIC_DEMO_ME === "eunbi" ? "eunbi" : "gooya") as PersonKey,
  /** Demo mode only: light or dark whatever Settings says (EXPO_PUBLIC_DEMO_APPEARANCE), to check both. */
  demoAppearance: demo && (process.env.EXPO_PUBLIC_DEMO_APPEARANCE === "dark" || process.env.EXPO_PUBLIC_DEMO_APPEARANCE === "light") ? (process.env.EXPO_PUBLIC_DEMO_APPEARANCE as "dark" | "light") : null,
  /** The Firebase project's OAuth web client, which Google Sign-In needs for a token Firebase accepts. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "557110398546-0pun0leaj6focm319stoo4u2nk5ksula.apps.googleusercontent.com",
  /** Cloud Functions (functions/), deployed in us-east1. */
  region: "us-east1",
  functionsUrl: "https://us-east1-gooya-37d79.cloudfunctions.net",
  /** Whether this build carries the real project's Firebase file (app.config.ts). */
  firebaseConfigured: Constants.expoConfig?.extra?.firebaseConfigured === true,
  version: Constants.expoConfig?.version ?? "0.0.0",
  build: Constants.expoConfig?.ios?.buildNumber ?? "0",
} as const;

/** What stops this build from working, if anything. */
export const setupProblem: string | null =
  !env.demo && !env.firebaseConfigured ? "This build has no Firebase configuration. Run npm run phone:setup (it downloads firebase/GoogleService-Info.plist), then build again." : null;
