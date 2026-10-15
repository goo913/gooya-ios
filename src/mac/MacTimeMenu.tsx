import type { HHmm } from "@shared/model";
import { useMemo, useState, type ComponentType } from "react";
import { formatHM } from "@/lib/format";
import { isMac, macControlView, type MacControlProps } from "../../modules/gooya-mac";

/** The Mac's own pop-up button (modules/gooya-mac, GooyaControlView); nothing elsewhere. */
const Native: ComponentType<MacControlProps> = isMac ? macControlView() : () => null;

const STEP = 15;

const minutesOf = (t: HHmm) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number): HHmm => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * A time on the Mac, picked from a menu as macOS's pop-up buttons pick ("9:00 AM ⌃⌄"): every quarter of an hour of the
 * day, and the time it has when that is between them (9:40 stays 9:40). The menu opens with the time it has under the
 * pointer, so a nearby time is a short move away and typing "4" goes to 4 o'clock.
 */
export function MacTimeMenu({ value, onChange, label }: { value: HHmm; onChange: (time: HHmm) => void; label?: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const now = minutesOf(value);
  const times = useMemo(() => {
    const all = Array.from({ length: (24 * 60) / STEP }, (_, i) => i * STEP);
    if (!all.includes(now)) all.push(now);
    return all.sort((a, b) => a - b);
  }, [now]);
  return (
    <Native
      kind="popup"
      accessibilityLabel={label}
      options={times.map((m) => formatHM(Math.floor(m / 60), m % 60))}
      selected={times.indexOf(now)}
      onAction={(e) => {
        const picked = times[e.nativeEvent.index ?? -1];
        if (picked != null && picked !== now) onChange(hhmm(picked));
      }}
      onMeasure={(e) => setSize({ width: e.nativeEvent.width, height: e.nativeEvent.height })}
      style={{ width: size?.width ?? 88, height: size?.height ?? 24 }}
    />
  );
}
