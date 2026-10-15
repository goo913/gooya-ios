import type { HHmm } from "@shared/model";
import { parseTypedTime } from "@shared/timeInput";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon } from "@/components/Icon";
import { formatHM } from "@/lib/format";
import { useColors, useIsDark } from "@/theme";

/**
 * A time on the Mac: a field to type it in ("12:45", "1245", "3:30 pm", "21:15"), as it is typed, and a button that
 * opens the hour, minute and AM/PM columns under its row (TimeWheels), as the date's calendar opens under the Date
 * row. A click in the field opens them too; what does not read as a time goes back to the time it was.
 */
export function MacTimeField({ value, onChange, open, onOpen, label = "Time" }: { value: HHmm; onChange: (time: HHmm) => void; open: boolean; onOpen: (open: boolean) => void; label?: string }) {
  const colors = useColors();
  const dark = useIsDark();
  const shown = formatHM(Number(value.slice(0, 2)), Number(value.slice(3, 5)));
  // What is typed, while the field has the keyboard, and the time it had then (whose AM or PM a bare hour keeps).
  const [typed, setTyped] = useState<string | null>(null);
  const [was, setWas] = useState(value);
  const type = (text: string) => {
    setTyped(text);
    // The time follows as it is typed, so a save at any moment (Return, Escape, a click away) has it.
    const t = parseTypedTime(text, was);
    if (t && t !== value) onChange(t);
  };
  const box = { backgroundColor: dark ? "rgba(255,255,255,0.08)" : "#ffffff", borderColor: open ? colors.blue : dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)" };
  return (
    <View style={[styles.box, box]}>
      <TextInput
        accessibilityLabel={label}
        // What is typed while it still says the time (or is not a time yet); the time when the columns changed it.
        value={typed != null && (parseTypedTime(typed, was) ?? value) === value ? typed : shown}
        onChangeText={type}
        onFocus={() => {
          setTyped(shown);
          setWas(value);
          onOpen(true);
        }}
        onBlur={() => setTyped(null)}
        selectTextOnFocus
        autoCorrect={false}
        spellCheck={false}
        style={[styles.input, { color: colors.label }]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={open ? `Hide ${label.toLowerCase()} picker` : `Show ${label.toLowerCase()} picker`} hitSlop={4} onPress={() => onOpen(!open)} style={styles.toggle}>
        <Icon name={open ? "chevron.up" : "chevron.down"} size={9} weight="semibold" color={colors.label2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", height: 24, borderRadius: 6, borderWidth: 1, paddingLeft: 7, paddingRight: 3 },
  input: { width: 70, fontSize: 13, paddingVertical: 0, fontVariant: ["tabular-nums"] },
  toggle: { width: 18, height: 20, alignItems: "center", justifyContent: "center" },
});
