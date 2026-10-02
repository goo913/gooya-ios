import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "sf-symbols-typescript";
import { useMetrics } from "@/lib/metrics";
import { MenuButton, type MenuAction, type MenuGroup } from "./NativeMenu";
import { useNav } from "@/store/nav";
import { GlassGroup, GlassIconButton, GlassPill, PillText } from "./Glass";
import { Icon } from "./Icon";
import { isMac } from "../../modules/gooya-mac";

interface TopChromeProps {
  /** The back pill's label ("2026", "September", "Calendar"); none hides it. */
  back?: string | null;
  onBack?: () => void;
  onViewOptions?: () => void;
  viewIcon?: "month" | "day";
  /** The view button's pull-down menu (Apple's "Single Day · Multi Day · List"); replaces onViewOptions. */
  viewMenu?: { icon: SFSymbol; groups: MenuGroup[]; actions?: MenuAction[] };
  /** Without the view button (Apple's year screen has only search and add). */
  hideView?: boolean;
  onSearch?: () => void;
  onAdd?: () => void;
  right?: ReactNode;
}

/** The floating pills over the top of a screen: back on the left, view · search · add on the right. */
export function TopChrome({ back, onBack, onViewOptions, viewIcon = "month", viewMenu, hideView, onSearch, onAdd, right }: TopChromeProps) {
  const insets = useSafeAreaInsets();
  const m = useMetrics();
  return (
    <View pointerEvents="box-none" style={[styles.top, { top: insets.top }]}>
      <View pointerEvents="box-none" style={styles.backSlot}>
        {back ? (
          <GlassPill label="Back" onPress={onBack} style={styles.backPill}>
            {/* The symbol's frame is wider than its glyph: pull the label in so the gap is Apple's 12 points. */}
            <View style={{ marginRight: -(0.37 * m.backChevron - 5.8) }}>
              <Icon name="chevron.left" size={m.backChevron} weight="semibold" />
            </View>
            <PillText>{back}</PillText>
          </GlassPill>
        ) : null}
      </View>
      {right ?? (
        <GlassGroup>
          {/* No view button without something for it to do (a dead button is worse than none). */}
          {hideView || (!viewMenu && !onViewOptions) ? null : viewMenu ? (
            <MenuButton icon={viewMenu.icon} iconSize={m.viewIcon * 0.8} width={m.barButtonWidths[0]} height={m.barHeight} accessibility="View options" groups={viewMenu.groups} actions={viewMenu.actions} />
          ) : (
            <GlassIconButton label="View options" width={m.barButtonWidths[0]} onPress={onViewOptions}>
              <Icon name={viewIcon === "day" ? "list.bullet.below.rectangle" : "rectangle.grid.1x2"} size={m.viewIcon} />
            </GlassIconButton>
          )}
          <GlassIconButton label="Search" width={m.barButtonWidths[1]} onPress={onSearch}>
            <Icon name="magnifyingglass" size={m.searchIcon} weight="medium" />
          </GlassIconButton>
          <GlassIconButton label="Add" width={m.barButtonWidths[2]} onPress={onAdd}>
            <Icon name="plus" size={m.addIcon} weight="medium" />
          </GlassIconButton>
        </GlassGroup>
      )}
    </View>
  );
}

interface BottomChromeProps {
  showToday?: boolean;
  /** What Today does (by default: scroll the current view to today). */
  onToday?: () => void;
  onCalendars?: () => void;
  onSettings?: () => void;
  left?: ReactNode;
}

/** The floating pills over the bottom: Today on the left, calendars · settings on the right. */
export function BottomChrome({ showToday = true, onToday, onCalendars, onSettings, left }: BottomChromeProps) {
  const insets = useSafeAreaInsets();
  const m = useMetrics();
  const goToday = useNav((s) => s.goToday);
  return (
    // Apple's bottom bar floats 28 points from the sides and the bottom edge (6 into the home indicator's area).
    <View pointerEvents="box-none" style={[styles.bottom, { bottom: Math.max(12, insets.bottom - 6) }]}>
      <View pointerEvents="box-none">
        {left ??
          (showToday ? (
            <GlassPill label="Today" onPress={onToday ?? goToday} height={m.bottomBarHeight} style={styles.todayPill}>
              <PillText>Today</PillText>
            </GlassPill>
          ) : null)}
      </View>
      {/* The Mac has its sidebar for the calendars and GOOYA → Settings… (⌘,): no buttons tucked in a corner. */}
      {isMac ? null : (
        <GlassGroup height={m.bottomBarHeight}>
          <GlassIconButton label="Calendars" width={54.85} onPress={onCalendars}>
            <Icon name="calendar" size={27} />
          </GlassIconButton>
          <GlassIconButton label="Settings" width={54.85} onPress={onSettings}>
            <Icon name="gearshape" size={25} />
          </GlassIconButton>
        </GlassGroup>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, zIndex: 50 },
  backSlot: { flexShrink: 1 },
  bottom: { position: "absolute", left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "center", zIndex: 50 },
  backPill: { paddingLeft: 9, paddingRight: 17.7, gap: 6 },
  todayPill: { paddingLeft: 17, paddingRight: 16 },
});
