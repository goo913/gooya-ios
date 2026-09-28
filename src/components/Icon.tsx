import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import { useColors } from "@/theme";

/** An SF Symbol, in the label colour unless said. */
export function Icon({ name, size = 22, color, weight = "medium" }: { name: SFSymbol; size?: number; color?: string; weight?: SymbolWeight }) {
  const colors = useColors();
  return <SymbolView name={name} size={size} tintColor={color ?? colors.label} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}
