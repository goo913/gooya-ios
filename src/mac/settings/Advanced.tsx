import { Host, Slider } from "@expo/ui/swift-ui";
import { otherPerson } from "@shared/people";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { patchSettings } from "@/lib/db";
import { tzAbbrev } from "@/lib/format";
import { useMe, usePerson } from "@/lib/people";
import { usePrefs } from "@/store/prefs";
import { useIsDark } from "@/theme";
import { showMainWindow } from "../../../modules/gooya-mac";
import { Checkbox, Note, PushButton, Section, Separator, text, text2 } from "./controls";

/** Settings → Advanced: routines in the timeline, the other person's hours, imported events, categories. */
export function Advanced() {
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const dark = useIsDark();
  const routinesInDay = usePrefs((s) => s.routinesInDay);
  const routinesInWeek = usePrefs((s) => s.routinesInWeek);
  const setRoutinesInDay = usePrefs((s) => s.setRoutinesInDay);
  const setRoutinesInWeek = usePrefs((s) => s.setRoutinesInWeek);
  const [dragging, setDragging] = useState<number | null>(null);
  const intensity = dragging ?? Math.round((mine.settings.routineIntensity ?? (dark ? 0.5 : 0.35)) * 100);
  const save = (key: string, value: unknown) => void patchSettings(me, { [key]: value });

  return (
    <View>
      <Section>
        <Checkbox title="Show routines in day view" checked={routinesInDay} onChange={setRoutinesInDay} />
        <Checkbox title="Show routines in week view" checked={routinesInWeek} onChange={setRoutinesInWeek} />
        <View style={styles.slider}>
          <Text style={[styles.label, text]}>Routine intensity:</Text>
          <Text style={[styles.end, text2]}>Subtle</Text>
          <Host style={styles.host}>
            <Slider
              value={intensity}
              min={15}
              max={85}
              step={5}
              onValueChange={(v) => setDragging(Math.round(v))}
              onEditingChanged={(editing) => {
                if (!editing && dragging != null) {
                  save("routineIntensity", dragging / 100);
                  setDragging(null);
                }
              }}
            />
          </Host>
          <Text style={[styles.end, text2]}>Bold</Text>
        </View>
      </Section>
      <Separator />
      <Section>
        <Checkbox title={`Show ${other.name}’s hours next to mine`} checked={mine.settings.secondGutter} onChange={(on) => save("secondGutter", on)} />
        <Note>
          A second column of hours in the day and week views, in {other.name}’s time zone ({tzAbbrev(other.timezone)}).
        </Note>
      </Section>
      <Separator />
      <Section>
        <Checkbox title="Show each event only once" checked={mine.settings.avoidDuplicates} onChange={(on) => save("avoidDuplicates", on)} />
        <Note>When the same event comes from both Apple and Google, GOOYA shows it once.</Note>
      </Section>
      <Separator />
      <Section style={styles.last}>
        <PushButton
          title="Edit Categories…"
          onPress={() => {
            showMainWindow();
            router.push("/categories");
          }}
        />
        <Note>Shared with {other.name}: a task’s circle and a schedule’s color.</Note>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  slider: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  label: { fontSize: 13 },
  end: { fontSize: 11 },
  host: { width: 180, height: 22 },
  last: { gap: 8 },
});
