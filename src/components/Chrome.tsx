import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNav } from "@/store/nav";
import { GlassGroup, GlassIconButton, GlassPill, PillText } from "./Glass";
import { Icon } from "./Icon";

interface TopChromeProps {
  /** The back pill's label ("2026", "September", "Calendar"); none hides it. */
  back?: string | null;
  onBack?: () => void;
  onViewOptions?: () => void;
  viewIcon?: "month" | "day";
  onSearch?: () => void;
  onAdd?: () => void;
  right?: ReactNode;
}

/** The floating pills over the top of a screen: back on the left, view · search · add on the right. */
export function TopChrome({ back, onBack, onViewOptions, viewIcon = "month", onSearch, onAdd, right }: TopChromeProps) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.top, { top: insets.top + 2 }]}>
      <View pointerEvents="box-none">
        {back ? (
          <GlassPill label="Back" onPress={onBack} style={styles.backPill}>
            <Icon name="chevron.left" size={22} weight="bold" />
            <PillText dim>{back}</PillText>
          </GlassPill>
        ) : null}
      </View>
      {right ?? (
        <GlassGroup>
          <GlassIconButton label="View options" onPress={onViewOptions}>
            <Icon name={viewIcon === "day" ? "list.bullet.below.rectangle" : "rectangle.grid.1x2"} size={24} />
          </GlassIconButton>
          <GlassIconButton label="Search" onPress={onSearch}>
            <Icon name="magnifyingglass" size={24} weight="semibold" />
          </GlassIconButton>
          <GlassIconButton label="Add" onPress={onAdd}>
            <Icon name="plus" size={26} />
          </GlassIconButton>
        </GlassGroup>
      )}
    </View>
  );
}

interface BottomChromeProps {
  showToday?: boolean;
  onCalendars?: () => void;
  onSettings?: () => void;
  left?: ReactNode;
}

/** The floating pills over the bottom: Today on the left, calendars · settings on the right. */
export function BottomChrome({ showToday = true, onCalendars, onSettings, left }: BottomChromeProps) {
  const insets = useSafeAreaInsets();
  const goToday = useNav((s) => s.goToday);
  return (
    <View pointerEvents="box-none" style={[styles.bottom, { bottom: insets.bottom + 12 }]}>
      <View pointerEvents="box-none">
        {left ??
          (showToday ? (
            <GlassPill label="Today" onPress={goToday}>
              <PillText>Today</PillText>
            </GlassPill>
          ) : null)}
      </View>
      <GlassGroup>
        <GlassIconButton label="Calendars" width={55} onPress={onCalendars}>
          <Icon name="calendar" size={24} />
        </GlassIconButton>
        <GlassIconButton label="Settings" width={55} onPress={onSettings}>
          <Icon name="gearshape" size={24} />
        </GlassIconButton>
      </GlassGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", zIndex: 50 },
  bottom: { position: "absolute", left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center", zIndex: 50 },
  backPill: { paddingLeft: 9, paddingRight: 20 },
});
