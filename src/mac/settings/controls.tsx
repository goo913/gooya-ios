import { createContext, useContext, useState, type ComponentType, type ReactNode } from "react";
import { PlatformColor, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useIsDark } from "@/theme";
import { isMac, macControlView, type MacControlProps } from "../../../modules/gooya-mac";

/**
 * The Settings window's parts, after Apple Calendar's Settings (macOS 27, measured at 1×): sections 20 points apart
 * with a line between them, inset 36 points from the window's sides; labels ending in ":" right-aligned before their
 * controls, the block of labels and controls centred in the window; the Mac's own checkboxes, pop-up and push buttons
 * (modules/gooya-mac, GooyaControlView); 13-point text, 11-point notes under a control.
 */

export const INSET = 36;

/** Text in the system's label colours (they follow the window's light or dark). */
export const text = { color: PlatformColor("labelColor") } as const;
export const text2 = { color: PlatformColor("secondaryLabelColor") } as const;

/** Colours the system has no name for: a box's fill and rim, a field's, a list's (light, then dark). */
export function useSettingsColors() {
  const dark = useIsDark();
  return dark
    ? { box: "rgba(255,255,255,0.04)", boxRim: "rgba(255,255,255,0.08)", field: "rgba(255,255,255,0.06)", fieldRim: "rgba(255,255,255,0.14)", list: "#1e1e1e", listRim: "rgba(255,255,255,0.1)", selected: "rgba(255,255,255,0.12)", tile: "#3a3a3c" }
    : { box: "#f7f7f7", boxRim: "#ececec", field: "#ffffff", fieldRim: "#e4e4e4", list: "#ffffff", listRim: "#e5e5e5", selected: "#dcdcdc", tile: "#ffffff" };
}

/** The width of a form's label column and of its control column: rows are centred in the window with them. */
const FormContext = createContext({ label: 120, control: 220 });

export function Form({ label, control, style, children }: { label: number; control: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <FormContext.Provider value={{ label, control }}>
      <View style={[styles.form, style]}>{children}</View>
    </FormContext.Provider>
  );
}

/** A section of a pane: 20 points above and below it, 36 at its sides. */
export function Section({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.section, style]}>{children}</View>;
}

export function Separator({ inset = INSET }: { inset?: number }) {
  return <View style={[styles.separator, { marginHorizontal: inset, backgroundColor: PlatformColor("separatorColor") }]} />;
}

/**
 * "Label:" and its control(s), with a note under them. The label is level with the control, or with the first of
 * several (`top`: how far its text is below their top, 0 for checkboxes, 4 for pop-up buttons).
 */
export function Row({ label, children, note, top }: { label?: string; children: ReactNode; note?: ReactNode; top?: number }) {
  const { label: labelWidth, control } = useContext(FormContext);
  return (
    <View style={styles.rowBlock}>
      <View style={[styles.row, { alignItems: top === undefined ? "center" : "flex-start" }]}>
        <Text numberOfLines={1} style={[styles.label, text, { width: labelWidth, marginTop: top ?? 0 }]}>
          {label ? `${label}:` : ""}
        </Text>
        <View style={[styles.controls, { width: control }]}>{children}</View>
      </View>
      {note ? (
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ width: labelWidth }} />
          <Note style={{ width: control }}>{note}</Note>
        </View>
      ) : null}
    </View>
  );
}

/** Small grey text: what a setting does. */
export function Note({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={[styles.note, text2]}>{children}</Text>
    </View>
  );
}

/** The Mac's own controls (nothing elsewhere: Settings is a window only on the Mac). */
const Native: ComponentType<MacControlProps> = isMac ? macControlView() : () => null;

/** A Mac control, sized to itself once it has measured (a pop-up button with `stretch` is as wide as its style says). */
function Control({ style, ...props }: MacControlProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <Native
      {...props}
      style={[{ height: size?.height ?? (props.kind === "checkbox" ? 16 : 24) }, !props.stretch && { width: size?.width ?? 0 }, style]}
      onMeasure={(e) => setSize({ width: e.nativeEvent.width, height: e.nativeEvent.height })}
    />
  );
}

export function Checkbox({ title, checked, onChange, enabled = true }: { title: string; checked: boolean; onChange: (checked: boolean) => void; enabled?: boolean }) {
  return <Control kind="checkbox" title={title} checked={checked} enabled={enabled} onAction={(e) => onChange(!!e.nativeEvent.checked)} />;
}

/** A pop-up button (⌃⌄) of `options`, showing `value`'s. */
export function Popup<T>({ options, value, onChange, width = 200, enabled = true }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; width?: number; enabled?: boolean }) {
  return (
    <Control
      kind="popup"
      stretch
      options={options.map((o) => o.label)}
      selected={options.findIndex((o) => o.value === value)}
      enabled={enabled}
      onAction={(e) => {
        const picked = options[e.nativeEvent.index ?? -1];
        if (picked) onChange(picked.value);
      }}
      style={{ width }}
    />
  );
}

export function PushButton({ title, onPress, enabled = true }: { title: string; onPress: () => void; enabled?: boolean }) {
  return <Control kind="button" title={title} enabled={enabled} onAction={() => onPress()} />;
}

/** A text field, as the Mac's (white, a thin rim, 22 points high). */
export function Field({ style, ...props }: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  const c = useSettingsColors();
  return (
    <View style={[styles.field, { backgroundColor: c.field, borderColor: c.fieldRim }, style]}>
      <TextInput placeholderTextColor={PlatformColor("placeholderTextColor")} autoCorrect={false} {...props} style={[styles.input, text]} />
    </View>
  );
}

/** A rounded box of a lighter grey (Apple's Accounts details). */
export function Box({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useSettingsColors();
  return <View style={[styles.box, { backgroundColor: c.box, borderColor: c.boxRim }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  form: { alignItems: "center", gap: 9 },
  section: { paddingVertical: 20, paddingHorizontal: INSET, gap: 6 },
  // A pixel, as the Mac's separators (one point on a 1× display).
  separator: { height: StyleSheet.hairlineWidth },
  rowBlock: { gap: 4 },
  row: { flexDirection: "row" },
  label: { fontSize: 13, textAlign: "right", paddingRight: 8 },
  controls: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  note: { fontSize: 11, lineHeight: 14 },
  field: { height: 22, borderRadius: 6, borderWidth: 1, justifyContent: "center", paddingHorizontal: 6 },
  input: { fontSize: 13, padding: 0 },
  box: { borderRadius: 8, borderWidth: 1 },
});
