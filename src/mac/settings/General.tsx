import { useState } from "react";
import { View } from "react-native";
import { patchSettings } from "@/lib/db";
import { OPEN_VIEWS, resolveOpenView } from "@/lib/openView";
import { useMe, usePerson } from "@/lib/people";
import { usePrefs, type AppearancePref } from "@/store/prefs";
import { openAtLogin, setOpenAtLogin } from "../../../modules/gooya-mac";
import { Checkbox, Form, Popup, Row, Section, Separator } from "./controls";

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings → General: how GOOYA looks and opens, what it shows, and the Mac's own (login, the menu bar). */
export function General() {
  const me = useMe();
  const mine = usePerson(me);
  const appearance = usePrefs((s) => s.appearance);
  const setAppearance = usePrefs((s) => s.setAppearance);
  const openView = usePrefs((s) => s.openView);
  const setOpenView = usePrefs((s) => s.setOpenView);
  const menuBarAgenda = usePrefs((s) => s.menuBarAgenda);
  const setMenuBarAgenda = usePrefs((s) => s.setMenuBarAgenda);
  const [atLogin, setAtLogin] = useState(openAtLogin);
  const save = (key: string, value: unknown) => void patchSettings(me, { [key]: value });

  return (
    <View>
      <Section>
        <Form label={150} control={200}>
          <Row label="Appearance">
            <Popup options={APPEARANCES} value={appearance} onChange={setAppearance} />
          </Row>
          <Row label="Open GOOYA in" note="On today, when GOOYA starts and after 15 minutes away.">
            <Popup options={OPEN_VIEWS.map(({ value, label }) => ({ value, label }))} value={resolveOpenView(openView, true)} onChange={setOpenView} />
          </Row>
        </Form>
      </Section>
      <Separator />
      <Section>
        <Checkbox title="Show completed tasks" checked={mine.settings.showCompleted} onChange={(on) => save("showCompleted", on)} />
        <Checkbox title="Show past schedules" checked={mine.settings.showPastSchedules} onChange={(on) => save("showPastSchedules", on)} />
      </Section>
      <Separator />
      <Section>
        <Checkbox title="Open GOOYA when you log in" checked={atLogin} onChange={(on) => void setOpenAtLogin(on).then(setAtLogin)} />
        <Checkbox title="Show today and tomorrow in the menu bar" checked={menuBarAgenda} onChange={setMenuBarAgenda} />
      </Section>
    </View>
  );
}
