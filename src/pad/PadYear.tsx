import type { DateKey } from "@shared/model";
import { makeKey, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { MONTH_SHORT, WEEKDAY_LETTERS } from "@/lib/format";
import { useToday } from "@/lib/useNow";
import { usePad } from "@/store/pad";
import { useColors, type Colors } from "@/theme";

// Apple Calendar's iPad year (iPadOS 27), measured at 820 points wide: three months across (four when the window is
// wide), each with its name (30 points, bold; this month's in red), the weekday letters (13 points) and the days (18
// points, 31 across by 28 down; today in a red circle). A month is 255 points from the next one down.

const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const MONTH_PITCH = 255;
const TOP = 24;

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function PadYear({ width, onYear, onPickMonth }: { width: number; onYear: (y: number) => void; onPickMonth: (monthKey: DateKey) => void }) {
  const colors = useColors();
  const today = useToday();
  const columns = width >= 1000 ? 4 : 3;
  const rows = 12 / columns;
  const yearH = TOP + rows * MONTH_PITCH;
  const inset = Math.max(20, (width - columns * 258) / 2 + 20);
  const pitch = (width - 2 * inset + 40) / columns;
  const listRef = useRef<FlatList<number>>(null);
  const date = usePad((s) => s.date);
  const jump = usePad((s) => s.jump);
  const initial = useMemo(() => Math.max(0, Math.min(YEARS.length - 1, Number(date.slice(0, 4)) - FIRST_YEAR)), [date]);
  // The year to show: scrolled to when the list has its size (a scroll asked for before is cut short at the top).
  const target = useRef(initial);
  const settle = useCallback(() => listRef.current?.scrollToOffset({ offset: target.current * yearH, animated: false }), [yearH]);
  useEffect(() => {
    target.current = Math.max(0, Math.min(YEARS.length - 1, Number(usePad.getState().date.slice(0, 4)) - FIRST_YEAR));
    onYear(YEARS[target.current]);
    const timers = [0, 150].map((ms) => setTimeout(settle, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, yearH]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => onYear(YEARS[Math.max(0, Math.min(YEARS.length - 1, Math.round(e.nativeEvent.contentOffset.y / yearH)))]), [onYear, yearH]);
  const renderItem = useCallback(
    ({ item }: { item: number }) => <YearBlock year={item} columns={columns} inset={inset} pitch={pitch} height={yearH} today={today} colors={colors} onPickMonth={onPickMonth} />,
    [columns, inset, pitch, yearH, today, colors, onPickMonth],
  );
  return (
    <FlatList
      key={`${columns}:${yearH}`}
      ref={listRef}
      data={YEARS}
      keyExtractor={(y) => String(y)}
      renderItem={renderItem}
      getItemLayout={(_, i) => ({ length: yearH, offset: i * yearH, index: i })}
      initialScrollIndex={initial}
      onContentSizeChange={() => requestAnimationFrame(settle)}
      onScroll={onScroll}
      scrollEventThrottle={32}
      windowSize={3}
      initialNumToRender={1}
      showsVerticalScrollIndicator={false}
      style={styles.fill}
    />
  );
}

const YearBlock = memo(function YearBlock({ year, columns, inset, pitch, height, today, colors, onPickMonth }: { year: number; columns: number; inset: number; pitch: number; height: number; today: DateKey; colors: Colors; onPickMonth: (k: DateKey) => void }) {
  const thisMonth = today.slice(0, 7);
  return (
    <View style={{ height }}>
      {Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const key = makeKey(year, m, 1);
        const startCol = weekdayOfKey(key);
        const days = daysInMonth(year, m);
        const current = key.slice(0, 7) === thisMonth;
        return (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityLabel={`${MONTH_SHORT[i]} ${year}`}
            onPress={() => onPickMonth(key)}
            style={[styles.month, { left: inset + (i % columns) * pitch, top: TOP + Math.floor(i / columns) * MONTH_PITCH }]}
          >
            <Text allowFontScaling={false} style={[styles.name, { color: current ? colors.red : colors.label }]}>
              {MONTH_SHORT[i]}
            </Text>
            <View style={styles.row}>
              {WEEKDAY_LETTERS.map((l, c) => (
                <Text key={c} allowFontScaling={false} style={[styles.letter, { color: colors.label }]}>
                  {l}
                </Text>
              ))}
            </View>
            {Array.from({ length: Math.ceil((startCol + days) / 7) }, (_, r) => (
              <View key={r} style={styles.row}>
                {Array.from({ length: 7 }, (_, c) => {
                  const d = r * 7 + c - startCol + 1;
                  if (d < 1 || d > days) return <View key={c} style={styles.cell} />;
                  const isToday = makeKey(year, m, d) === today;
                  return (
                    <View key={c} style={[styles.cell, isToday && { backgroundColor: colors.red, borderRadius: 14 }]}>
                      <Text allowFontScaling={false} style={[styles.day, { color: isToday ? "#ffffff" : colors.label, fontWeight: isToday ? "600" : "400" }]}>
                        {d}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  month: { position: "absolute", width: 217 },
  name: { fontSize: 30, fontWeight: "700", marginLeft: -2, marginBottom: 8 },
  row: { flexDirection: "row", height: 28, alignItems: "center" },
  letter: { width: 31, textAlign: "center", fontSize: 13, fontWeight: "600" },
  cell: { width: 31, height: 28, alignItems: "center", justifyContent: "center" },
  day: { fontSize: 18 },
});
