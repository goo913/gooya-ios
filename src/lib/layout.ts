import { useWindowDimensions } from "react-native";

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
