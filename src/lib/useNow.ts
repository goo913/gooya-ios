import { deviceTimeZone, todayKey } from "@shared/time";
import { useEffect, useState } from "react";
import { AppState, useWindowDimensions } from "react-native";

/** Current time, refreshed on an interval (default: every minute, aligned) and when the app comes to the front. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, intervalMs - (Date.now() % intervalMs));
    };
    timer = setTimeout(tick, intervalMs - (Date.now() % intervalMs));
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

export const viewerTz = deviceTimeZone();

export function useToday(): string {
  const now = useNow(60_000);
  return todayKey(viewerTz, now);
}

export function useViewportWidth(): number {
  return useWindowDimensions().width;
}
