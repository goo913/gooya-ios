import type { HHmm } from "@shared/model";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useColors, useIsDark } from "@/theme";

/**
 * A time picked as the iPhone's Alarm picks it, for the Mac (the iPhone and iPad have Apple's own wheels): the hour,
 * the minute (every one of them) and AM or PM, each in a column of its own. A column scrolls, with the mouse or the
 * trackpad, and the time in the band across the middle is chosen when it stops; a click chooses a time at once.
 */

const ROW = 28;
const SHOWN = 5;
/** Room above the first time and under the last, so either can sit in the band. */
const PAD = ROW * Math.floor(SHOWN / 2);

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const HALVES = ["AM", "PM"];

export function TimeWheels({ value, onChange }: { value: HHmm; onChange: (time: HHmm) => void }) {
  const colors = useColors();
  const dark = useIsDark();
  const h = Number(value.slice(0, 2));
  const min = Number(value.slice(3, 5));
  const pm = h >= 12;
  const set = (hour: number, minute: number) => onChange(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  return (
    <View style={styles.wrap}>
      <View pointerEvents="none" style={[styles.band, { top: PAD, backgroundColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }]} />
      <Column label="Hour" items={HOURS} index={(h % 12 || 12) - 1} onPick={(i) => set(((i + 1) % 12) + (pm ? 12 : 0), min)} colors={colors} />
      <Text style={[styles.colon, { color: colors.label }]}>:</Text>
      <Column label="Minute" items={MINUTES} index={min} onPick={(i) => set(h, i)} colors={colors} />
      <Column label="AM or PM" items={HALVES} index={pm ? 1 : 0} onPick={(i) => set((h % 12) + (i === 1 ? 12 : 0), min)} colors={colors} />
    </View>
  );
}

function Column({ label, items, index, onPick, colors }: { label: string; items: string[]; index: number; onPick: (i: number) => void; colors: ReturnType<typeof useColors> }) {
  const ref = useRef<ScrollView>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picked = useRef(index);
  // The chosen time into the band at once: chosen here (a click, a scroll that stopped) or elsewhere (typed in its
  // field). Not animated, so the column never stops on the way to it.
  useEffect(() => {
    picked.current = index;
    ref.current?.scrollTo({ y: index * ROW, animated: false });
  }, [index]);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );
  const choose = (i: number) => {
    // The same time: back into the band, if a scroll left it off centre.
    if (i === picked.current) return ref.current?.scrollTo({ y: i * ROW, animated: true });
    picked.current = i;
    onPick(i);
  };
  // Once a scroll stops (a wheel, a trackpad, a drag), the time nearest the band.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => choose(Math.max(0, Math.min(items.length - 1, Math.round(y / ROW)))), 140);
  };
  return (
    <ScrollView
      ref={ref}
      accessibilityLabel={label}
      style={styles.column}
      contentContainerStyle={styles.columnContent}
      contentOffset={{ x: 0, y: index * ROW }}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
    >
      {items.map((item, i) => (
        <Pressable key={item} accessibilityRole="button" accessibilityLabel={item} accessibilityState={{ selected: i === index }} onPress={() => choose(i)} style={styles.row}>
          <Text allowFontScaling={false} style={[styles.item, { color: i === index ? colors.label : colors.label2 }, i === index && styles.chosen]}>
            {item}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: ROW * SHOWN, paddingHorizontal: 10, marginBottom: 6 },
  band: { position: "absolute", left: 10, right: 10, height: ROW, borderRadius: 7 },
  column: { width: 64, height: ROW * SHOWN, flexGrow: 0 },
  columnContent: { paddingVertical: PAD },
  row: { height: ROW, alignItems: "center", justifyContent: "center" },
  item: { fontSize: 15, fontVariant: ["tabular-nums"] },
  chosen: { fontWeight: "600" },
  colon: { fontSize: 15, fontWeight: "600", marginHorizontal: 2 },
});
