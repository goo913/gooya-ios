import { getApp } from "@react-native-firebase/app";
import { getAuth } from "@react-native-firebase/auth";
import { getFirestore } from "@react-native-firebase/firestore";
import { getFunctions } from "@react-native-firebase/functions";
import { env } from "./env";

/** The Firebase project through the native SDKs (configured by GoogleService-Info.plist, see app.config.ts). */
export const app = getApp();
export const auth = getAuth(app);
/** Firestore keeps its data on the phone, so the app opens straight from it. */
export const db = getFirestore(app);
export const functions = getFunctions(app, env.region);
