import type { updateCurrentUser } from "@react-native-firebase/auth";
import type { PersonKey } from "@shared/people";
import { create } from "zustand";

export type SessionStatus = "loading" | "signedOut" | "unauthorized" | "ready";
/** The signed-in Firebase user (the modular API does not re-export its type). */
export type AuthUser = NonNullable<Parameters<typeof updateCurrentUser>[1]>;

interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  me: PersonKey | null;
  rejectedEmail: string | null;
  error: string | null;
  signingIn: boolean;
  setSignedOut: () => void;
  setUnauthorized: (email: string) => void;
  setReady: (user: AuthUser | null, me: PersonKey) => void;
  setError: (error: string | null) => void;
  setSigningIn: (signingIn: boolean) => void;
  dismissUnauthorized: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  me: null,
  rejectedEmail: null,
  error: null,
  signingIn: false,
  setSignedOut: () => {
    // Keep the "private" screen visible until the person dismisses it.
    if (get().status === "unauthorized") return;
    set({ status: "signedOut", user: null, me: null, signingIn: false });
  },
  setUnauthorized: (email) => set({ status: "unauthorized", rejectedEmail: email, user: null, me: null, signingIn: false }),
  setReady: (user, me) => set({ status: "ready", user, me, rejectedEmail: null, error: null, signingIn: false }),
  setError: (error) => set({ error, signingIn: false }),
  setSigningIn: (signingIn) => set({ signingIn }),
  dismissUnauthorized: () => set({ status: "signedOut", rejectedEmail: null }),
}));
