import { StyleSheet, useWindowDimensions } from "react-native";
import { isMac } from "../../modules/gooya-mac";

/**
 * GOOYA follows Apple Calendar on each device: the iPhone's screens on a phone, the iPad's (a toolbar with Day · Week ·
 * Month · Year, the month as a grid of days with times, the day beside its details) from this window width up. An iPad
 * window made narrow (Split View, Stage Manager, Slide Over) gets the phone's screens, as Apple's apps do.
 */
export const PAD_MIN_WIDTH = 700;

export function useIsPad(): boolean {
  const { width } = useWindowDimensions();
  return width >= PAD_MIN_WIDTH;
}

/**
 * A line drawn as a view (a grid's, a list's): a hairline, but a whole point on the Mac. There a half-point line at a
 * fractional position can snap to no pixel at all on a 1× display (every other column line of the month went missing).
 */
export const RULE = isMac ? 1 : StyleSheet.hairlineWidth;
