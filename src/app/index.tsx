import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassGroup, GlassIconButton, GlassPill, PillText } from "@/components/Glass";
import { Icon } from "@/components/Icon";
import { useColors } from "@/theme";

/** Placeholder until the month view lands: the chrome (pills) over the page. */
export default function MonthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.label, marginTop: insets.top + 61 }]}>September</Text>
      <View style={[styles.top, { top: insets.top + 2 }]}>
        <GlassPill label="Back" style={{ paddingLeft: 9 }}>
          <Icon name="chevron.left" size={22} weight="bold" />
          <PillText dim>2026</PillText>
        </GlassPill>
        <GlassGroup>
          <GlassIconButton label="View options"><Icon name="rectangle.grid.1x2" size={24} /></GlassIconButton>
          <GlassIconButton label="Search"><Icon name="magnifyingglass" size={24} weight="semibold" /></GlassIconButton>
          <GlassIconButton label="Add"><Icon name="plus" size={26} weight="medium" /></GlassIconButton>
        </GlassGroup>
      </View>
      <View style={[styles.bottom, { bottom: insets.bottom + 12 }]}>
        <GlassPill label="Today"><PillText>Today</PillText></GlassPill>
        <GlassGroup>
          <GlassIconButton label="Calendars" width={55}><Icon name="calendar" size={24} /></GlassIconButton>
          <GlassIconButton label="Settings" width={55}><Icon name="gearshape" size={24} /></GlassIconButton>
        </GlassGroup>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { fontSize: 34, fontWeight: "700", paddingHorizontal: 16 },
  top: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bottom: { position: "absolute", left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
