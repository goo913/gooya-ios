import { Host, Toggle } from "@expo/ui/swift-ui";
import { controlSize, labelsHidden, tint, toggleStyle } from "@expo/ui/swift-ui/modifiers";
import { MacPopup } from "@/mac/MacPopup";
import { Children, isValidElement, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, Switch as RNSwitch, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { WEEKDAY_LETTERS } from "@/lib/format";
import { useColors, useIsDark } from "@/theme";
import { Icon } from "./Icon";
import { RULE } from "@/lib/layout";
import { isMac } from "../../modules/gooya-mac";

// On the Mac the forms are Apple Calendar's (its new-event popover and Settings, macOS 27): 13-point rows in rounded
// grey groups, small section titles, and macOS's own switches and pop-up menus (SwiftUI, through Expo UI).

/** Inset grouped list (Apple's "New Event" style). */
export function Group({ children, header, footer, style }: { children: ReactNode; header?: ReactNode; footer?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const dark = useIsDark();
  const items = Children.toArray(children).filter(Boolean);
  if (isMac) {
    return (
      <View style={[mac.group, style]}>
        {header ? <Text style={[mac.groupHeader, { color: colors.label2 }]}>{header}</Text> : null}
        <View style={[mac.card, { backgroundColor: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
          {items.map((c, i) => (
            <View key={i}>
              {i > 0 ? <View style={[mac.hairline, { backgroundColor: colors.separator }]} /> : null}
              {c}
            </View>
          ))}
        </View>
        {footer ? <Text style={[mac.groupFooter, { color: colors.label2 }]}>{footer}</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.group, style]}>
      {header ? <Text style={[styles.groupHeader, { color: colors.label2 }]}>{typeof header === "string" ? header.toUpperCase() : header}</Text> : null}
      <View style={[styles.card, { backgroundColor: colors.bg3 }]}>
        {items.map((c, i) => (
          <View key={i}>
            {i > 0 ? <View style={[styles.hairline, { backgroundColor: colors.separator }]} /> : null}
            {c}
          </View>
        ))}
      </View>
      {footer ? <Text style={[styles.groupFooter, { color: colors.label2 }]}>{footer}</Text> : null}
    </View>
  );
}

interface RowProps {
  label?: ReactNode;
  /** An SF Symbol at the left of the label. */
  icon?: string;
  iconColor?: string;
  /** A second line under the label (the picked date, in blue). */
  detail?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  dim?: boolean;
  labelColor?: string;
  accessibilityLabel?: string;
}

/** 44pt row: label at left, control at right. A label next to a switch wraps (large text) instead of running under it. */
export function Row({ label, icon, iconColor, detail, children, onPress, chevron, dim, labelColor, accessibilityLabel }: RowProps) {
  const colors = useColors();
  const beside = isValidElement(children) && children.type === Switch;
  const body = (
    <>
      {icon ? <Icon name={icon as never} size={isMac ? 15 : 22} color={iconColor ?? colors.label2} weight={isMac ? "regular" : "medium"} /> : null}
      {label != null ? (
        <View style={beside ? styles.labelWraps : styles.labelWrap}>
          {typeof label === "string" ? <Text style={[isMac ? mac.label : styles.label, { color: labelColor ?? colors.label }]}>{label}</Text> : label}
          {detail ? typeof detail === "string" ? <Text style={[isMac ? mac.detail : styles.detail, { color: isMac ? colors.label2 : colors.blue }]}>{detail}</Text> : detail : null}
        </View>
      ) : null}
      <View style={beside ? styles.rightFixed : styles.right}>{children}</View>
      {chevron ? <Icon name="chevron.right" size={isMac ? 11 : 14} color={colors.label3} weight="semibold" /> : null}
    </>
  );
  const rowStyle = isMac ? mac.row : styles.row;
  if (!onPress) return <View style={[rowStyle, dim && styles.dim]}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [rowStyle, dim && styles.dim, pressed && { backgroundColor: colors.fill4 }]}>
      {body}
    </Pressable>
  );
}

/** The red of Apple Calendar's switches on the Mac (its accent). */
const MAC_SWITCH = "#ff383c";

/** The system switch. */
export function Switch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const colors = useColors();
  if (isMac) {
    // macOS's own small switch (a UISwitch is a checkbox on the Mac).
    return (
      <View style={disabled ? styles.dim : undefined} pointerEvents={disabled ? "none" : "auto"}>
        <Host matchContents>
          <Toggle isOn={value} onIsOnChange={onChange} label={label} modifiers={[toggleStyle("switch"), controlSize("small"), labelsHidden(), tint(MAC_SWITCH)]} />
        </Host>
      </View>
    );
  }
  return <RNSwitch value={value} onValueChange={onChange} accessibilityLabel={label} disabled={disabled} trackColor={{ true: colors.green }} />;
}

/** A row whose value is picked from a native action sheet (Repeat, Priority, …). */
export function ValueRow({ label, icon, value, options, onPick, dim, title }: { label: string; icon?: string; value: string; options: string[]; onPick: (label: string, index: number) => void; dim?: boolean; title?: string }) {
  const colors = useColors();
  if (isMac) {
    // macOS's pop-up menu ("Never ⌃⌄"), as Calendar's popover has for Repeat, Early Reminder and Priority.
    return (
      <Row label={label} icon={icon} dim={dim}>
        <View pointerEvents={dim ? "none" : "auto"}>
          <MacPopup value={value} options={options} onPick={onPick} />
        </View>
      </Row>
    );
  }
  return (
    <Row
      label={label}
      icon={icon}
      dim={dim}
      onPress={dim ? undefined : () => pickOption(options, value, onPick, title)}
    >
      <Text style={[styles.value, { color: colors.label2 }]} numberOfLines={1}>
        {value}
      </Text>
      <Icon name="chevron.up.chevron.down" size={14} color={colors.label3} />
    </Row>
  );
}

/** A native action sheet listing options; the current one is marked. */
export function pickOption(options: string[], current: string | null, onPick: (label: string, index: number) => void, title?: string): void {
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options.map((o) => (o === current ? `✓ ${o}` : o)), "Cancel"], cancelButtonIndex: options.length },
    (i) => {
      if (i < options.length) onPick(options[i], i);
    },
  );
}

export function TextRow({ value, onChange, placeholder, leading, style, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; leading?: ReactNode } & Omit<TextInputProps, "value" | "onChangeText" | "onChange" | "style"> & { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[isMac ? mac.textRow : styles.textRow, style]}>
      {leading}
      <TextInput defaultValue={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.label3} style={[isMac ? mac.input : styles.input, { color: colors.label }]} {...rest} />
    </View>
  );
}

/** Circle toggles S M T W T F S (0 = Sunday). */
export function DayToggles({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const colors = useColors();
  return (
    <View style={styles.days}>
      {WEEKDAY_LETTERS.map((l, i) => {
        const on = value.includes(i);
        return (
          <Pressable key={i} accessibilityState={{ selected: on }} onPress={() => onChange(on ? value.filter((d) => d !== i) : [...value, i].sort())} style={[styles.day, { backgroundColor: on ? colors.blue : colors.fill3 }]}>
            <Text style={[styles.dayText, { color: on ? "#ffffff" : colors.label }]}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DestructiveButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const colors = useColors();
  const dark = useIsDark();
  return (
    <View style={isMac ? mac.group : styles.group}>
      <Pressable onPress={onPress} style={({ pressed }) => [isMac ? mac.destructive : styles.destructive, { backgroundColor: pressed ? colors.fill4 : isMac ? (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") : colors.bg3 }]}>
        <Text style={[isMac ? mac.destructiveText : styles.destructiveText, { color: colors.red }]}>{children}</Text>
      </Pressable>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const colors = useColors();
  if (isMac) return <Text style={[mac.section, { color: colors.label2 }]}>{children}</Text>;
  return <Text style={[styles.section, { color: colors.label }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  group: { paddingHorizontal: 16 },
  groupHeader: { marginBottom: 6, paddingHorizontal: 16, fontSize: 13 },
  groupFooter: { marginTop: 6, paddingHorizontal: 16, fontSize: 13, lineHeight: 17 },
  card: { borderRadius: 12, overflow: "hidden" },
  hairline: { height: RULE, marginLeft: 16 },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  dim: { opacity: 0.4 },
  labelWrap: { flexShrink: 0 },
  labelWraps: { flexShrink: 1, paddingVertical: 10 },
  rightFixed: { flexGrow: 1, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  label: { fontSize: 17 },
  detail: { fontSize: 15, lineHeight: 18 },
  right: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  value: { fontSize: 17, flexShrink: 1 },
  textRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 17, paddingVertical: 10 },
  days: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 15, fontWeight: "600" },
  destructive: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  destructiveText: { fontSize: 17 },
  section: { paddingHorizontal: 32, fontSize: 20, fontWeight: "600", opacity: 0.9, marginBottom: -8 },
});

/** Apple Calendar's popover and Settings on the Mac, measured on macOS 27. */
const mac = StyleSheet.create({
  group: { paddingHorizontal: 10 },
  groupHeader: { marginBottom: 5, paddingHorizontal: 10, fontSize: 11, fontWeight: "600" },
  groupFooter: { marginTop: 5, paddingHorizontal: 10, fontSize: 11, lineHeight: 14 },
  card: { borderRadius: 10, overflow: "hidden" },
  hairline: { height: RULE, marginLeft: 10, marginRight: 10 },
  row: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 4 },
  label: { fontSize: 13 },
  detail: { fontSize: 11, lineHeight: 14 },
  textRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10 },
  input: { flex: 1, fontSize: 13, paddingVertical: 7 },
  section: { paddingHorizontal: 20, fontSize: 11, fontWeight: "600", marginBottom: -6 },
  destructive: { height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  destructiveText: { fontSize: 13 },
});
