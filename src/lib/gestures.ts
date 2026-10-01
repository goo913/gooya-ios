import { Gesture, type PanGesture } from "react-native-gesture-handler";
import { isMac } from "../../modules/gooya-mac";

/**
 * A drag that lifts what is under the finger to move it: on a touch screen after holding it still for `holdMs` (so a
 * swipe still scrolls), and with the Mac's mouse or trackpad at once, as in Apple Calendar for Mac (press and drag; a
 * click without moving stays a click).
 */
export function liftPan(holdMs: number): PanGesture {
  return isMac ? Gesture.Pan().minDistance(4) : Gesture.Pan().activateAfterLongPress(holdMs);
}
