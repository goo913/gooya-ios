import type { DateKey } from "@shared/model";
import { makeKey, weekdayOfKey } from "@shared/time";
import { memo, useEffect, useMemo, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MONTH_SHORT } from "@/lib/format";
import { useMetrics } from "@/lib/metrics";
import { useToday } from "@/lib/useNow";
import { useNav } from "@/store/nav";
import { useColors, type Colors } from "@/theme";

const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Apple Calendar's year view, measured on an iPhone 15 (393 points wide): three columns of small months at the default
 * Text Size (and one step either side), two columns of larger months from two steps up. Positions are cap tops within
 * a year's block; the block starts right under the top bar.
 */
interface YearLayout {
  columns: number;
  /** Left edge of each column's day grid. */
  lefts: number[];
  cell: number;
  number: number;
  name: number;
  nameInset: number;
  title: number;
  titleCenter: number;
  titleCapTop: number;
  firstNameCapTop: number;
  nameToRows: number;
  rowPitch: number;
  monthPitch: number;
  yearPitch: number;
  mark: { w: number; h: number; radius: number };
}

function yearLayout(width: number, fontScale: number): YearLayout {
  const k = width / 393;
  if (fontScale < 1.18) {
    return {
      columns: 3,
      lefts: [18.2, 141.8, 265.8].map((x) => x * k),
      cell: 15 * k,
      number: 9,
      name: 18,
      nameInset: 3.2,
      title: 28,
      titleCenter: 191.3 * k,
      titleCapTop: 10.7,
      firstNameCapTop: 54.3,
      nameToRows: 29.7,
      rowPitch: 19.35,
      monthPitch: 156.2,
      yearPitch: 711,
      // A circle, or a rounded square once the numbers grow (as Apple draws it one step up).
      mark: fontScale > 1.05 ? { w: 15.7, h: 12.3, radius: 3.5 } : { w: 16.3, h: 16.3, radius: 8.15 },
    };
  }
  const firstNameCapTop = 60.7;
  const monthPitch = 281.6;
  return {
    columns: 2,
    lefts: [9.9, 200.1].map((x) => x * k),
    cell: 25.1 * k,
    number: 15,
    name: 29.5,
    nameInset: 6,
    title: 28,
    titleCenter: 191.3 * k,
    titleCapTop: 10.7,
    firstNameCapTop,
    nameToRows: 55,
    rowPitch: 35.65,
    monthPitch,
    yearPitch: firstNameCapTop - 10.7 + 5 * monthPitch + 317.8,
    mark: { w: 22.3, h: 20.7, radius: 5 },
  };
}

/** Where a text's cap top sits inside its line box (SF Pro): place a text at `capTop - capOffset(size, line)`. */
const capOffset = (size: number, line: number) => line / 2 - 0.355 * size;

export function YearView({ year, onPickMonth }: { year: number; onPickMonth: (monthKey: DateKey) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const m = useMetrics();
  const layout = useMemo(() => yearLayout(width, m.fontScale), [width, m.fontScale]);
  const listRef = useRef<FlatList<number>>(null);
  const today = useToday();
  const todayNonce = useNav((s) => s.todayNonce);
  const index = Math.min(YEARS.length - 1, Math.max(0, year - FIRST_YEAR));
  useEffect(() => {
    if (todayNonce > 0) listRef.current?.scrollToOffset({ offset: (Number(today.slice(0, 4)) - FIRST_YEAR) * layout.yearPitch, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNonce]);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const titleLine = layout.title * 1.2;
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={{ height: insets.top + m.barHeight }} />
      <FlatList
        key={layout.columns}
        ref={listRef}
        data={YEARS}
        keyExtractor={(y) => String(y)}
        getItemLayout={(_, i) => ({ length: layout.yearPitch, offset: i * layout.yearPitch, index: i })}
        initialScrollIndex={index}
        windowSize={3}
        initialNumToRender={1}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        renderItem={({ item: y }) => (
          <View style={{ height: layout.yearPitch, width }}>
            <Text
              allowFontScaling={false}
              style={[
                styles.year,
                { color: y === currentYear ? colors.red : colors.label, fontSize: layout.title, lineHeight: titleLine, top: layout.titleCapTop - capOffset(layout.title, titleLine), width: 200, left: layout.titleCenter - 100 },
              ]}
            >
              {y}
            </Text>
            {MONTH_SHORT.map((name, i) => (
              <MiniMonth
                key={name}
                y={y}
                m={i + 1}
                name={name}
                today={today}
                isCurrent={y === currentYear && i + 1 === currentMonth}
                layout={layout}
                left={layout.lefts[i % layout.columns]}
                capTop={layout.firstNameCapTop + Math.floor(i / layout.columns) * layout.monthPitch}
                colors={colors}
                onPick={onPickMonth}
              />
            ))}
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
  layout: YearLayout;
  left: number;
  /** The month name's cap top within the year block. */
  capTop: number;
  colors: Colors;
  onPick: (monthKey: DateKey) => void;
}

const MiniMonth = memo(function MiniMonth({ y, m, name, today, isCurrent, layout, left, capTop, colors, onPick }: MiniMonthProps) {
  const startCol = weekdayOfKey(makeKey(y, m, 1));
  const days = daysInMonth(y, m);
  const nameLine = layout.name * 1.2;
  const rowsTop = capTop + layout.nameToRows - capOffset(layout.number, layout.rowPitch);
  const nameTop = capTop - capOffset(layout.name, nameLine);
  const cells = [];
  for (let d = 1; d <= days; d++) {
    const i = startCol + d - 1;
    const key = makeKey(y, m, d);
    const isToday = key === today;
    cells.push(
      <View key={d} style={[styles.cell, { left: (i % 7) * layout.cell, top: Math.floor(i / 7) * layout.rowPitch, width: layout.cell, height: layout.rowPitch }]}>
        {isToday ? <View style={[styles.mark, { width: layout.mark.w, height: layout.mark.h, borderRadius: layout.mark.radius, backgroundColor: colors.red }]} /> : null}
        <Text allowFontScaling={false} style={[styles.day, { fontSize: layout.number, lineHeight: layout.rowPitch, color: isToday ? "#ffffff" : colors.label }]}>
          {d}
        </Text>
      </View>,
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${y}`}
      onPress={() => onPick(makeKey(y, m, 1))}
      style={[styles.month, { left, top: nameTop, width: layout.cell * 7, height: rowsTop - nameTop + 6 * layout.rowPitch }]}
    >
      <Text allowFontScaling={false} style={[styles.name, { fontSize: layout.name, lineHeight: nameLine, paddingLeft: layout.nameInset, color: isCurrent ? colors.red : colors.label }]}>
        {name}
      </Text>
      <View style={[styles.grid, { top: rowsTop - nameTop }]}>{cells}</View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  year: { position: "absolute", fontWeight: "700", textAlign: "center" },
  month: { position: "absolute" },
  name: { fontWeight: "700" },
  grid: { position: "absolute", left: 0, right: 0 },
  cell: { position: "absolute", alignItems: "center", justifyContent: "center" },
  mark: { position: "absolute" },
  day: { fontWeight: "500", textAlign: "center", fontVariant: ["tabular-nums"] },
});
