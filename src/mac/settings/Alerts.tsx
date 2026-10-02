import { otherPerson } from "@shared/people";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { EARLY_REMINDERS } from "@/lib/alerts";
import { patchSettings } from "@/lib/db";
import { env } from "@/lib/env";
import { useMe, usePerson } from "@/lib/people";
import { forgetPushToken, notificationsAllowed, refreshPushToken, requestNotifications } from "@/lib/push";
import { Checkbox, Form, Popup, Row, Section, Separator } from "./controls";

/** Settings → Alerts: notifications on this Mac, and new tasks' early reminder. */
export function Alerts() {
  const me = useMe();
  const mine = usePerson(me);
  const other = usePerson(otherPerson(me));
  const [push, setPush] = useState<boolean | null>(null);
  useEffect(() => {
    void notificationsAllowed().then(setPush);
  }, []);
  const togglePush = async (on: boolean) => {
    if (on) {
      const granted = await requestNotifications();
      setPush(granted);
      if (granted) await refreshPushToken(me);
      else void Linking.openSettings();
    } else {
      await forgetPushToken(me);
      setPush(false);
    }
  };

  return (
    <View>
      <Section>
        <Form label={150} control={250}>
          <Row label="Notifications" top={0} note={env.demo ? "Demo mode: no notifications." : undefined}>
            <View style={{ gap: 6 }}>
              <Checkbox title="Allow on this Mac" checked={!!push} enabled={!env.demo && push !== null} onChange={(on) => void togglePush(on)} />
              <Checkbox title={`When ${other.name} adds to my calendar`} checked={mine.settings.notifyOnOtherAdds} onChange={(on) => void patchSettings(me, { notifyOnOtherAdds: on })} />
            </View>
          </Row>
        </Form>
      </Section>
      <Separator />
      <Section>
        <Form label={150} control={250}>
          <Row label="Early reminder" note="New tasks get it, as well as the alert at their time (9:00 AM for a date only).">
            <Popup options={EARLY_REMINDERS} value={mine.settings.defaultAlertTimed} onChange={(v) => void patchSettings(me, { defaultAlertTimed: v })} width={180} />
          </Row>
        </Form>
      </Section>
    </View>
  );
}
