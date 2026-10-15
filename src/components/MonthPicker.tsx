import type { DateKey } from "@shared/model";
import { addDaysKey, makeKey, weekdayOfKey } from "@shared/time";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import { MONTH_NAMES, WEEKDAY_LETTERS } from "@/lib/format";
import { useToday } from "@/lib/useNow";
import { useColors } from "@/theme";

/**
 * A day picked on a month, for the Mac's forms: the month with ‹ ›, the weekdays' letters, and its weeks, the day picked
 * in a blue circle and today's number red; days before `min` cannot be picked. It fits the popover's width (the system's
 * inline calendar on the Mac is wider than the popover, and left Saturday out).
 */
export function MonthPicker({ value, onChange, min }: { value: DateKey; onChange: (key: DateKey) => void; min?: DateKey }) {
  const colors = useColors();
  const today = useToday();
  // The month shown: the picked day's, until ‹ or › moves it (and again the picked day's once that changes).
  const [view, setView] = useState({ for: value, month: value.slice(0, 7) });
  const month = view.for === value ? view.month : value.slice(0, 7);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const step = (dir: 1 | -1) => {
    const n = y * 12 + m - 1 + dir;
    setView({ for: value, month: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}` });
  };
  const first = makeKey(y, m, 1);
  const start = addDaysKey(first, -weekdayOfKey(first));
  // As many weeks as the month needs (five, or six).
  const weeks = Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => addDaysKey(start, r * 7 + c))).filter((week) => week.some((k) => k.startsWith(month)));
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text allowFontScaling={false} style={[styles.title, { color: colors.label }]}>
          {MONTH_NAMES[m - 1]} {y}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={6} onPress={() => step(-1)} style={styles.arrow}>
          <Icon name="chevron.left" size={12} weight="semibold" color={colors.blue} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={6} onPress={() => step(1)} style={styles.arrow}>
          <Icon name="chevron.right" size={12} weight="semibold" color={colors.blue} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAY_LETTERS.map((l, i) => (
          <Text key={i} allowFontScaling={false} style={[styles.letter, { color: colors.label2 }]}>
            {l}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.week}>
          {week.map((key) => {
            const inMonth = key.startsWith(month);
            const picked = key === value;
            const off = !!min && key < min;
            return (
              <Pressable key={key} accessibilityRole="button" accessibilityLabel={key} accessibilityState={{ selected: picked, disabled: off }} disabled={off || !inMonth} onPress={() => onChange(key)} style={styles.cell}>
                {inMonth ? (
                  <View style={[styles.mark, picked && { backgroundColor: colors.blue }]}>
                    <Text allowFontScaling={false} style={[styles.day, { color: picked ? "#ffffff" : key === today ? colors.red : colors.label }, picked && styles.pickedDay, off && styles.off]}>
                      {Number(key.slice(8, 10))}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, marginBottom: 6 },
  title: { flex: 1, fontSize: 13, fontWeight: "600" },
  arrow: { width: 24, height: 22, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row" },
  letter: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "600", marginBottom: 2 },
  cell: { flex: 1, height: 30, alignItems: "center", justifyContent: "center" },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  day: { fontSize: 13, fontVariant: ["tabular-nums"] },
  pickedDay: { fontWeight: "600" },
  off: { opacity: 0.3 },
});
