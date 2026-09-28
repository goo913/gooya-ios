/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";
import { withAppDelegate, withEntitlementsPlist, withInfoPlist, type ConfigPlugin } from "expo/config-plugins";

/**
 * GOOYA's native configuration, read when the iPhone project is generated (`npx expo prebuild`, scripts/phone.mjs)
 * and when the development server starts.
 *
 * Firebase's file for the real project is kept out of git: scripts/phone.mjs downloads it into firebase/ with the
 * Firebase CLI (`npm run phone:setup`). Without it the app is built with the placeholder in firebase/placeholder/,
 * which carries no keys: such a build can only run in demo mode (EXPO_PUBLIC_DEMO=1).
 */
const APP_ID = process.env.APP_ID || "com.hybertec.gooya";
/** A build under another app id (a personal Apple team's) says so on the Home Screen. */
const APP_NAME = APP_ID === "com.hybertec.gooya" ? "GOOYA" : "GOOYA Dev";
/** HyberTec LLC's Apple team, which signs the real app (scripts/phone.mjs picks it; APPLE_TEAM_ID overrides). */
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || "YSK7CHH56P";

/** The version people see and the build number the App Store counts up (release.json; the publishing command bumps it). */
const release = JSON.parse(fs.readFileSync(path.join(__dirname, "release.json"), "utf8")) as { version: string; build: number };

function servicesFile(): { file: string; real: boolean } {
  if (process.env.GOOGLE_SERVICES_PLIST) return { file: process.env.GOOGLE_SERVICES_PLIST, real: true };
  if (fs.existsSync(path.join(__dirname, "firebase", "GoogleService-Info.plist"))) return { file: "./firebase/GoogleService-Info.plist", real: true };
  return { file: "./firebase/placeholder/GoogleService-Info.plist", real: false };
}
const plist = servicesFile();

/** Google Sign-In returns to the app through the reversed iOS client id Firebase puts in GoogleService-Info.plist. */
function googleUrlScheme(): string | null {
  if (process.env.GOOGLE_IOS_URL_SCHEME) return process.env.GOOGLE_IOS_URL_SCHEME;
  if (!plist.real) return null;
  const file = path.resolve(__dirname, plist.file);
  if (!fs.existsSync(file)) return null;
  const m = /<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(file, "utf8"));
  return m ? m[1] : null;
}
const iosUrlScheme = googleUrlScheme();

/**
 * A build signed by a free Apple team (Xcode's "Personal Team", APPLE_PERSONAL_TEAM=1) cannot sign push
 * notifications, so the capability the messaging plugin declares is left out of it.
 */
const withoutPushOnPersonalTeam: ConfigPlugin = (config) =>
  process.env.APPLE_PERSONAL_TEAM === "1"
    ? withEntitlementsPlist(config, (c) => {
        delete c.modResults["aps-environment"];
        return c;
      })
    : config;

/**
 * An app built with the iOS 27 SDK stops at launch unless it uses the scene life cycle, and Expo's SDK 57 template
 * does not yet. This makes the app delegate leave the window to a scene delegate that starts React Native in it.
 * Run after the other plugins, so what they add to the app delegate (Firebase's start) stays.
 */
const withSceneLifecycle: ConfigPlugin = (config) =>
  withInfoPlist(
    withAppDelegate(config, (c) => {
      let src = c.modResults.contents;
      if (!src.includes("ExpoAppSceneDelegate")) {
        const steps: [RegExp, string][] = [
          [/class AppDelegate: ExpoAppDelegate \{/, "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {"],
          [/\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)/, ""],
          [/\n[ \t]*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)/, ""],
        ];
        for (const [pattern, replacement] of steps) {
          if (!pattern.test(src)) throw new Error(`withSceneLifecycle: AppDelegate.swift no longer has ${pattern}; update app.config.ts.`);
          src = src.replace(pattern, replacement);
        }
        src += "\n// The window, and React Native in it, under the scene life cycle (app.config.ts, withSceneLifecycle).\n@objc(SceneDelegate)\nclass SceneDelegate: ExpoAppSceneDelegate {}\n";
      }
      c.modResults.contents = src;
      return c;
    }),
    (c) => {
      c.modResults.UIApplicationSceneManifest = {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate" }],
        },
      };
      return c;
    },
  );

/** A development build opens straight into the app, without Expo's developer-menu introduction over it. */
const withoutDevMenuIntro: ConfigPlugin = (config) =>
  withInfoPlist(config, (c) => {
    c.modResults.EXDevMenuIsOnboardingFinished = true;
    return c;
  });

const withFinalTouches: ConfigPlugin = (config) => withoutDevMenuIntro(withSceneLifecycle(withoutPushOnPersonalTeam(config)));

export default ({ config }: ConfigContext): ExpoConfig =>
  withFinalTouches({
    ...config,
    name: APP_NAME,
    slug: "gooya",
    version: release.version,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "gooya",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: String(release.build),
      appleTeamId: APPLE_TEAM_ID,
      googleServicesFile: plist.file,
      supportsTablet: false,
      infoPlist: {
        // Only the standard HTTPS kind of encryption (exempt): App Store Connect never asks the export-compliance question.
        ITSAppUsesNonExemptEncryption: false,
        CFBundleDisplayName: APP_NAME,
        // Alerts arrive as pushes from the server with the app closed too.
        UIBackgroundModes: ["remote-notification"],
        NSUserNotificationsUsageDescription: "GOOYA reminds you of your tasks, and tells you when 은비 adds something to your calendar.",
      },
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 160,
          backgroundColor: "#000000",
          dark: { image: "./assets/images/splash-icon.png", backgroundColor: "#000000" },
        },
      ],
      // React Native Firebase brings Firebase's iOS SDK in through Swift Package Manager, which needs dynamic frameworks.
      ["expo-build-properties", { ios: { useFrameworks: "dynamic", deploymentTarget: "26.0" } }],
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      "@react-native-firebase/messaging",
      ...(iosUrlScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme }] as [string, unknown]] : []),
      ["expo-notifications", { color: "#0a84ff" }],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      firebaseConfigured: plist.real,
    },
  });
