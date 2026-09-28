import { GoogleAuthProvider, signInWithCredential } from "@react-native-firebase/auth";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { env } from "./env";
import { auth } from "./firebase";

let configured = false;
function configure(): void {
  if (configured) return;
  GoogleSignin.configure({ webClientId: env.googleWebClientId });
  configured = true;
}

/** Google's account picker, then Firebase. False when the person closed the picker. */
export async function signInWithGoogle(): Promise<boolean> {
  configure();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return false;
  if (!response.data.idToken) throw new Error("Google did not send a sign-in token. Try again.");
  await signInWithCredential(auth, GoogleAuthProvider.credential(response.data.idToken));
  return true;
}

/** Forget the Google account too, so the next sign-in asks which one. */
export async function signOutOfGoogle(): Promise<void> {
  if (configured) await GoogleSignin.signOut().catch(() => undefined);
}
