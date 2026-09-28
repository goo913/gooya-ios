import { getMessaging, setBackgroundMessageHandler } from "@react-native-firebase/messaging";

// A push that arrives with the app closed: iOS shows the notification itself (the server sends a notification
// payload); nothing more to do here, but the handler must exist before the app starts.
setBackgroundMessageHandler(getMessaging(), async () => undefined);
