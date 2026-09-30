import { getMessaging, setBackgroundMessageHandler } from "@react-native-firebase/messaging";
import { syncRemindersFromPush } from "./reminders";
import { markWidgetStale } from "./widget";

// A push that arrives with the app closed: iOS shows the notification itself (the server sends a notification
// payload), and the widget is told its copy of the calendar may be out of date. A silent one ("sync") says one of this
// person's reminders changed elsewhere: iOS wakes GOOYA for a moment to take it to Reminders.
setBackgroundMessageHandler(getMessaging(), async (message) => {
  markWidgetStale();
  if (message.data?.kind === "sync") await syncRemindersFromPush().catch(() => undefined);
});
