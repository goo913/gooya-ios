import type { DateKey } from "@shared/model";
import { addDaysKey, makeKey, weekdayOfKey } from "@shared/time";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { MONTH_NAMES, WEEKDAY_LETTERS } from "@/lib/format";
import { useToday } from "@/lib/useNow";
import { usePad } from "@/store/pad";
import { useMac } from "./state";
import { useMacColors, useWindowActive, type MacColors } from "./theme";

// Apple Calendar's year on the Mac (macOS 27), measured at 1×: the twelve months three across and four down, filling the
// window (a year to a page); each month's name in red (17 points), the weekdays' letters (9 points, grey) and six weeks
// of days (11 points, regular): the month's own dark, weekends grey, the days of the months around it faint; today in a
// red circle. A click on a month's name shows that month; a click on a day chooses it, a double-click shows it.

const FIRST_YEAR = 2015;
const LAST_YEAR = 2039;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

export interface MacYearActions {
  showMonth: (monthKey: DateKey) => void;
  showDay: (key: DateKey) => void;
}

export function MacYear({ width, onYear, actions }: { width: number; onYear: (y: number) => void; actions: MacYearActions }) {
  const colors = useMacColors();
  const today = useToday();
  const active = useWindowActive();
  const [height, setHeight] = useState(800);
  const listRef = useRef<FlatList<number>>(null);
  const date = usePad((s) => s.date);
  const jump = usePad((s) => s.jump);
  const selected = useMac((s) => s.day);
  const initial = useMemo(() => Math.max(0, Math.min(YEARS.length - 1, Number(date.slice(0, 4)) - FIRST_YEAR)), [date]);
  useEffect(() => {
    const index = Math.max(0, Math.min(YEARS.length - 1, Number(usePad.getState().date.slice(0, 4)) - FIRST_YEAR));
    onYear(YEARS[index]);
    const t = setTimeout(() => listRef.current?.scrollToOffset({ offset: index * height, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, height]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => onYear(YEARS[Math.max(0, Math.min(YEARS.length - 1, Math.round(e.nativeEvent.contentOffset.y / height)))]), [onYear, height]);
  const renderItem = useCallback(
    ({ item }: { item: number }) => <YearPage year={item} width={width} height={height} today={today} selected={selected} colors={colors} active={active} actions={actions} />,
    [width, height, today, selected, colors, active, actions],
  );
  return (
    <View style={styles.fill} onLayout={(e) => setHeight(Math.max(400, e.nativeEvent.layout.height))}>
      <FlatList
        key={height}
        ref={listRef}
        data={YEARS}
        keyExtractor={(y) => String(y)}
        renderItem={renderItem}
        getItemLayout={(_, i) => ({ length: height, offset: i * height, index: i })}
        initialScrollIndex={initial}
        onScroll={onScroll}
        scrollEventThrottle={32}
        snapToInterval={height}
        decelerationRate="fast"
        windowSize={3}
        initialNumToRender={1}
        showsVerticalScrollIndicator={false}
        style={styles.fill}
      />
    </View>
  );
}

interface PageProps {
  year: number;
  width: number;
  height: number;
  today: DateKey;
  selected: DateKey | null;
  colors: MacColors;
  active: boolean;
  actions: MacYearActions;
}

const YearPage = memo(function YearPage({ year, width, height, today, selected, colors, active, actions }: PageProps) {
  // Apple's proportions: about 4% of the width either side, a column of days 1/22 of the rest (the months' gaps are
  // a little over half a column), a quarter of the height to each row of months.
  const margin = Math.round(width * 0.038);
  const col = (width - 2 * margin) / 22.16;
  const monthW = col * 7;
  const gap = col * 1.08;
  const pitch = height / 4;
  const dayPitch = Math.min(26, pitch * 0.095);
  return (
    <View style={{ height }}>
      {Array.from({ length: 12 }, (_, i) => (
        <Month
          key={i}
          year={year}
          month={i + 1}
          left={margin + (i % 3) * (monthW + gap)}
          top={Math.floor(i / 3) * pitch + 6}
          col={col}
          pitch={pitch}
          dayPitch={dayPitch}
          today={today}
          selected={selected}
          colors={colors}
          active={active}
          actions={actions}
        />
      ))}
    </View>
  );
});

interface MonthProps {
  year: number;
  month: number;
  left: number;
  top: number;
  col: number;
  pitch: number;
  dayPitch: number;
  today: DateKey;
  selected: DateKey | null;
  colors: MacColors;
  active: boolean;
  actions: MacYearActions;
}

function Month({ year, month, left, top, col, pitch, dayPitch, today, selected, colors, active, actions }: MonthProps) {
  const first = makeKey(year, month, 1);
  const start = addDaysKey(first, -weekdayOfKey(first));
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return (
    <View style={[styles.month, { left, top, width: col * 7 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={MONTH_NAMES[month - 1]} onPress={() => actions.showMonth(first)} style={styles.nameHit}>
        <Text allowFontScaling={false} style={[styles.name, { color: colors.red, marginLeft: col * 0.12 }]}>
          {MONTH_NAMES[month - 1]}
        </Text>
      </Pressable>
      <View style={[styles.row, { marginTop: pitch * 0.165 - 30, height: dayPitch }]}>
        {WEEKDAY_LETTERS.map((l, c) => (
          <Text key={c} allowFontScaling={false} style={[styles.letter, { width: col, color: colors.text2 }]}>
            {l}
          </Text>
        ))}
      </View>
      <View style={{ marginTop: pitch * 0.128 - dayPitch }}>
        {Array.from({ length: 6 }, (_, r) => (
          <View key={r} style={[styles.row, { height: dayPitch }]}>
            {Array.from({ length: 7 }, (_, c) => {
              const key = addDaysKey(start, r * 7 + c);
              const inMonth = key.startsWith(prefix);
              return <Day key={c} dateKey={key} width={col} size={Math.min(dayPitch, 22)} inMonth={inMonth} weekend={c === 0 || c === 6} isToday={key === today && inMonth} isSelected={key === selected && inMonth} colors={colors} active={active} actions={actions} />;
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function Day({ dateKey, width, size, inMonth, weekend, isToday, isSelected, colors, active, actions }: { dateKey: DateKey; width: number; size: number; inMonth: boolean; weekend: boolean; isToday: boolean; isSelected: boolean; colors: MacColors; active: boolean; actions: MacYearActions }) {
  const gesture = useMemo(() => {
    const single = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => useMac.getState().selectDay(dateKey));
    const double = Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd(() => actions.showDay(dateKey));
    return Gesture.Simultaneous(single, double);
  }, [dateKey, actions]);
  const mark = isToday ? (active ? colors.red : colors.inactive) : isSelected ? colors.field : null;
  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.day, { width }]}>
        <View style={[styles.dayMark, { width: size, height: size, borderRadius: size / 2 }, mark ? { backgroundColor: mark } : null]}>
          <Text allowFontScaling={false} style={[styles.dayText, { color: isToday ? "#ffffff" : !inMonth ? colors.faded : weekend ? colors.text2 : colors.text, fontWeight: isToday ? "600" : "400" }]}>
            {Number(dateKey.slice(8, 10))}
          </Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  month: { position: "absolute" },
  nameHit: { alignSelf: "flex-start" },
  name: { fontSize: 17, height: 22, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center" },
  letter: { textAlign: "center", fontSize: 9, fontWeight: "500" },
  day: { alignItems: "center", justifyContent: "center" },
  dayMark: { alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 11, fontVariant: ["tabular-nums"] },
});
