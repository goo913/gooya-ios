import type { ComponentType, ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { isMac, macMenuView, type MacMenuItem, type MacMenuViewProps } from "../../modules/gooya-mac";

export type { MacMenuItem };

/** The native view (the Mac only; elsewhere what it wraps is drawn as it is). */
const Native: ComponentType<MacMenuViewProps> | null = isMac ? macMenuView() : null;

/** Where a right-click was: in the menu's view (x, y) and in the window (wx, wy). */
export interface MenuPoint {
  x: number;
  y: number;
  wx: number;
  wy: number;
}

/**
 * A right-click menu (macOS's, as Apple Calendar's on a day or an event) over its area: `onPick` gets the command's id
 * and where the click was. Laid over what it is for (an empty view of its size, on top of an item; under the items, on a
 * day): a click passes on to the gestures around it, a right-click opens the menu.
 */
export function MacMenu({ items, onPick, style, children }: { items: MacMenuItem[]; onPick: (id: string, at: MenuPoint) => void; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  if (!Native) return <View style={style}>{children}</View>;
  return (
    <Native items={items} onPick={(e) => onPick(e.nativeEvent.id, e.nativeEvent)} style={style}>
      {children}
    </Native>
  );
}
