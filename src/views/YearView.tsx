import type { DateKey } from "@shared/model";
import { makeKey, weekdayOfKey } from "@shared/time";
import { memo, useEffect, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MONTH_NAMES } from "@/lib/format";
import { useToday } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useColors, type Colors } from "@/theme";

const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const YEAR_H = 66 + 4 * 150 + 24;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function YearView({ year, onPickMonth }: { year: number; onPickMonth: (monthKey: DateKey) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<number>>(null);
  const today = useToday();
  const todayNonce = useNav((s) => s.todayNonce);
  const index = Math.min(YEARS.length - 1, Math.max(0, year - FIRST_YEAR));
  useEffect(() => {
    if (todayNonce > 0) listRef.current?.scrollToOffset({ offset: (Number(today.slice(0, 4)) - FIRST_YEAR) * YEAR_H, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNonce]);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={{ height: insets.top + 58 }} />
      <FlatList
        ref={listRef}
        data={YEARS}
        keyExtractor={(y) => String(y)}
        getItemLayout={(_, i) => ({ length: YEAR_H, offset: i * YEAR_H, index: i })}
        initialScrollIndex={index}
        windowSize={3}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        renderItem={({ item: y }) => (
          <View style={{ height: YEAR_H }}>
            <Text style={[styles.year, { color: y === currentYear ? colors.red : colors.label }]}>{y}</Text>
            <View style={[styles.rule, { backgroundColor: colors.separator }]} />
            <View style={styles.grid}>
              {MONTH_NAMES.map((name, i) => (
                <MiniMonth key={name} y={y} m={i + 1} name={name} today={today} isCurrent={y === currentYear && i + 1 === currentMonth} width={(width - 32 - 28) / 3} colors={colors} onPick={() => onPickMonth(makeKey(y, i + 1, 1))} />
              ))}
            </View>
          </View>
        )}
      />
    </View>
  );
}

interface MiniMonthProps {
  y: number;
  m: number;
  name: string;
  today: string;
  isCurrent: boolean;
  width: number;
  colors: Colors;
  onPick: () => void;
}

const MiniMonth = memo(function MiniMonth({ y, m, name, today, isCurrent, width, colors, onPick }: MiniMonthProps) {
  const startCol = weekdayOfKey(makeKey(y, m, 1));
  const days = daysInMonth(y, m);
  const cellW = width / 7;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = i - startCol + 1;
    const key = day >= 1 && day <= days ? makeKey(y, m, day) : null;
    const isToday = key === today;
    cells.push(
      <View key={i} style={[styles.miniCell, { width: cellW }]}>
        {key ? (
          <View style={[styles.miniDay, isToday && { backgroundColor: colors.red }]}>
            <Text style={[styles.miniDayText, { color: isToday ? "#ffffff" : colors.label }, isToday && { fontWeight: "600" }]}>{day}</Text>
          </View>
        ) : null}
      </View>,
    );
  }
  return (
    <Pressable onPress={onPick} style={{ width }}>
      <Text style={[styles.miniName, { color: isCurrent ? colors.red : colors.label }]}>{name}</Text>
      <View style={styles.miniGrid}>{cells}</View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  year: { fontSize: 34, fontWeight: "700", lineHeight: 41, paddingHorizontal: 16 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, marginTop: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 14, paddingHorizontal: 16, marginTop: 10 },
  miniName: { fontSize: 15, fontWeight: "600", lineHeight: 18, marginBottom: 4 },
  miniGrid: { flexDirection: "row", flexWrap: "wrap" },
  miniCell: { height: 16, alignItems: "center", justifyContent: "center" },
  miniDay: { height: 15, minWidth: 15, paddingHorizontal: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  miniDayText: { fontSize: 10, lineHeight: 12, fontVariant: ["tabular-nums"] },
});
