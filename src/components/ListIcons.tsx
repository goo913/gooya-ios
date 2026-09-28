import { StyleSheet, View } from "react-native";
import { Icon } from "./Icon";

/** Glyphs for task lists (names are stored on the list document), as SF Symbols. */
export const LIST_ICON_NAMES = ["list", "checkmark", "house", "cart", "briefcase", "heart", "star", "gift", "airplane", "book", "graduationcap", "forkknife", "pawprint", "dumbbell", "creditcard", "leaf"] as const;
export type ListIconName = (typeof LIST_ICON_NAMES)[number];

const SYMBOLS: Record<ListIconName, string> = {
  list: "list.bullet",
  checkmark: "checkmark",
  house: "house.fill",
  cart: "cart.fill",
  briefcase: "briefcase.fill",
  heart: "heart.fill",
  star: "star.fill",
  gift: "gift.fill",
  airplane: "airplane",
  book: "book.fill",
  graduationcap: "graduationcap.fill",
  forkknife: "fork.knife",
  pawprint: "pawprint.fill",
  dumbbell: "dumbbell.fill",
  creditcard: "creditcard.fill",
  leaf: "leaf.fill",
};

export function listSymbol(name: string): string {
  return SYMBOLS[(name as ListIconName) in SYMBOLS ? (name as ListIconName) : "list"];
}

/** Coloured circle badge with the list glyph, like Reminders. */
export function ListBadge({ icon, color, size = 30 }: { icon: string; color: string; size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Icon name={listSymbol(icon) as never} size={Math.round(size * 0.5)} color="#ffffff" weight="semibold" />
    </View>
  );
}

const styles = StyleSheet.create({ badge: { alignItems: "center", justifyContent: "center" } });
