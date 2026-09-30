import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useColors } from "@/theme";

/**
 * Apple's Starts / Ends rows: the label at the left, the date and time pickers at the right. The pickers of the rows
 * line up in columns, each as wide as its widest picker (the time "12:00 AM" is wider than "1:00 AM"), and when they do
 * not fit beside the label (a large Text Size) they go under it, still at the right. The pickers size themselves, so
 * the columns are measured as they are drawn.
 */
export interface WhenLayout {
  fits: boolean;
  dateWidth: number;
  timeWidth: number;
  measure: (what: "row" | "label" | "date" | "time", e: LayoutChangeEvent) => void;
}

const PADDING = 16;
const LABEL_GAP = 12;
const PICKER_GAP = 6;

/** The shared measurements of one group's Starts / Ends rows. */
export function useWhenLayout(): WhenLayout {
  const [sizes, setSizes] = useState({ row: 0, label: 0, date: 0, time: 0 });
  const measure = useCallback((what: "row" | "label" | "date" | "time", e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    // The row follows the sheet's width; a label or picker column only grows (a narrower picker keeps the column).
    setSizes((s) => (what === "row" ? (s.row === w ? s : { ...s, row: w }) : w > s[what] ? { ...s, [what]: w } : s));
  }, []);
  return useMemo(() => {
    const needed = sizes.label + LABEL_GAP + sizes.date + (sizes.time ? PICKER_GAP + sizes.time : 0);
    return { fits: !sizes.row || needed <= sizes.row - 2 * PADDING, dateWidth: sizes.date, timeWidth: sizes.time, measure };
  }, [sizes, measure]);
}

export function WhenRow({ layout, label, date, time }: { layout: WhenLayout; label: string; date: ReactNode; time?: ReactNode }) {
  const colors = useColors();
  const pickers = (
    <View style={[styles.pickers, !layout.fits && styles.pickersUnder]}>
      <View style={[styles.slot, layout.dateWidth ? { width: layout.dateWidth } : null]}>
        <View style={styles.own} onLayout={(e) => layout.measure("date", e)}>
          {date}
        </View>
      </View>
      {time ? (
        <View style={[styles.slot, layout.timeWidth ? { width: layout.timeWidth } : null]}>
          <View style={styles.own} onLayout={(e) => layout.measure("time", e)}>
            {time}
          </View>
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={[styles.row, !layout.fits && styles.rowUnder]} onLayout={(e) => layout.measure("row", e)}>
      <Text style={[styles.label, !layout.fits && styles.labelUnder, { color: colors.label }]} onLayout={(e) => layout.measure("label", e)}>
        {label}
      </Text>
      {pickers}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: PADDING, paddingVertical: 5 },
  rowUnder: { flexDirection: "column", alignItems: "stretch", paddingVertical: 8, gap: 6 },
  label: { fontSize: 17 },
  labelUnder: { alignSelf: "flex-start" },
  pickers: { flexDirection: "row", alignItems: "center", gap: PICKER_GAP, marginLeft: LABEL_GAP },
  pickersUnder: { alignSelf: "flex-end", marginLeft: 0 },
  slot: { alignItems: "flex-end" },
  // Sized by the picker inside, so its width can be measured.
  own: { alignSelf: "flex-end" },
});
