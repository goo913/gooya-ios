import { getMessaging, setBackgroundMessageHandler } from "@react-native-firebase/messaging";
import { markWidgetStale } from "./widget";

// A push that arrives with the app closed: iOS shows the notification itself (the server sends a notification
// payload). The widget is told its copy of the calendar may be out of date.
setBackgroundMessageHandler(getMessaging(), async () => {
  markWidgetStale();
});
