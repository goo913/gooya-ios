import { Button, Host, Menu, Text as SwiftText } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, font, foregroundStyle, menuIndicator } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/Icon";
import { useColors } from "@/theme";

/**
 * macOS's pop-up menu as Calendar's popover has it ("Never ⌃⌄", no border; the menu lists the choices, the current one
 * ticked). A menu of buttons rather than SwiftUI's picker, whose shown value does not follow the one it is given; the
 * chevrons after it (a menu's label on the Mac would put a symbol first).
 */
export function MacPopup({ value, options, onPick }: { value: string; options: string[]; onPick: (option: string, index: number) => void }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Host matchContents>
        <Menu label={<SwiftText modifiers={[font({ size: 13 }), foregroundStyle(colors.label)]}>{value}</SwiftText>} modifiers={[buttonStyle("borderless"), menuIndicator("hidden"), controlSize("small")]}>
          {options.map((o, i) => (
            <Button key={`${i}:${o}`} label={o} systemImage={o === value ? "checkmark" : undefined} onPress={() => onPick(o, i)} />
          ))}
        </Menu>
      </Host>
      <View pointerEvents="none" style={[styles.chevrons, { backgroundColor: colors.fill3 }]}>
        <Icon name="chevron.up.chevron.down" size={9} weight="semibold" color={colors.label2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  chevrons: { width: 16, height: 16, borderRadius: 5, alignItems: "center", justifyContent: "center" },
});
