import { Button, Host, Image, Label, Menu, Picker, Section } from "@expo/ui/swift-ui";
import { accessibilityLabel, contentShape, frame, pickerStyle, shapes, tag } from "@expo/ui/swift-ui/modifiers";
import * as Haptics from "expo-haptics";
import type { SFSymbol } from "sf-symbols-typescript";
import { useColors } from "@/theme";

/**
 * A bar button that opens the system's own pull-down menu when tapped, as Apple Calendar's view button does
 * ("Single Day · Multi Day · List", with a checkmark on the current one). SwiftUI's Menu, through Expo UI.
 */

export interface MenuChoice<T extends string> {
  value: T;
  label: string;
  icon: SFSymbol;
}

/** One group of mutually exclusive choices: the chosen one carries the checkmark. */
export interface MenuGroup<T extends string = string> {
  selection: T;
  choices: MenuChoice<T>[];
  onSelect: (value: T) => void;
}

export interface MenuAction {
  label: string;
  icon: SFSymbol;
  onPress: () => void;
}

interface Props {
  /** The button's symbol and its size. */
  icon: SFSymbol;
  iconSize: number;
  /** The tap target: the whole button, not just the symbol. */
  width: number;
  height: number;
  accessibility: string;
  groups: MenuGroup[];
  actions?: MenuAction[];
}

export function MenuButton({ icon, iconSize, width, height, accessibility, groups, actions }: Props) {
  const colors = useColors();
  return (
    <Host style={{ width, height }}>
      <Menu
        label={
          <Image
            systemName={icon}
            size={iconSize}
            color={colors.label}
            modifiers={[frame({ width, height }), contentShape(shapes.rectangle()), accessibilityLabel(accessibility)]}
          />
        }
      >
        {groups.map((g, i) => (
          <Picker
            key={i}
            selection={g.selection}
            onSelectionChange={(v: string) => {
              void Haptics.selectionAsync();
              g.onSelect(v);
            }}
            modifiers={[pickerStyle("inline")]}
          >
            {g.choices.map((c) => (
              <Label key={c.value} title={c.label} systemImage={c.icon} modifiers={[tag(c.value)]} />
            ))}
          </Picker>
        ))}
        {actions?.length ? (
          <Section>
            {actions.map((a) => (
              <Button key={a.label} label={a.label} systemImage={a.icon} onPress={a.onPress} />
            ))}
          </Section>
        ) : null}
      </Menu>
    </Host>
  );
}
