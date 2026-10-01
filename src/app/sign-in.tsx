import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signIn } from "@/lib/auth";
import { useSession } from "@/store/session";
import { useColors } from "@/theme";

/** The sign-in screen: the couple's photo, the name, one Google button. */
export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { status, error, signingIn, rejectedEmail, dismissUnauthorized } = useSession();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        <Image source={require("../../assets/images/icon.png")} style={styles.logo} contentFit="cover" />
        <Text style={[styles.title, { color: colors.label }]}>GOOYA</Text>
        <Text style={[styles.subtitle, { color: colors.label2 }]}>구야 · 은비</Text>
      </View>
      <View style={styles.bottom}>
        {status === "unauthorized" ? (
          <View style={styles.notice}>
            <Text style={[styles.noticeText, { color: colors.label }]}>This calendar is private.</Text>
            <Text style={[styles.noticeSub, { color: colors.label2 }]}>{rejectedEmail} isn’t one of us.</Text>
            <Pressable onPress={dismissUnauthorized} style={styles.link}>
              <Text style={[styles.linkText, { color: colors.blue }]}>Try another account</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Sign in with Google" onPress={() => void signIn()} disabled={signingIn} style={({ pressed }) => [styles.button, { backgroundColor: colors.label, opacity: pressed || signingIn ? 0.7 : 1 }]}>
            <Text style={[styles.g, { color: colors.bg }]}>G</Text>
            <Text style={[styles.buttonText, { color: colors.bg }]}>{signingIn ? "Signing in…" : "Sign in with Google"}</Text>
          </Pressable>
        )}
        {error ? <Text style={[styles.error, { color: colors.red }]}>{error}</Text> : null}
        <Text style={[styles.foot, { color: colors.label3 }]}>Private calendar for two.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "space-between", paddingHorizontal: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  logo: { width: 128, height: 128, borderRadius: 30, marginBottom: 20 },
  title: { fontSize: 32, fontWeight: "800", letterSpacing: 0.5 },
  subtitle: { fontSize: 18 },
  // A phone's width at most: on an iPad or a Mac the button doesn't run across the window.
  bottom: { gap: 14, alignItems: "center", alignSelf: "center", width: "100%", maxWidth: 420 },
  button: { height: 56, borderRadius: 28, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  g: { fontSize: 22, fontWeight: "700" },
  buttonText: { fontSize: 19, fontWeight: "600" },
  error: { fontSize: 14 },
  foot: { fontSize: 15 },
  notice: { alignItems: "center", gap: 6 },
  noticeText: { fontSize: 20, fontWeight: "600" },
  noticeSub: { fontSize: 15 },
  link: { paddingVertical: 10 },
  linkText: { fontSize: 17 },
});
