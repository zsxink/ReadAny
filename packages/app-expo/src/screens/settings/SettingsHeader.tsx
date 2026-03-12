import { useNavigation } from "@react-navigation/native";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronLeftIcon } from "../../components/ui/Icon";
import { fontSize, fontWeight, spacing, useColors } from "../../styles/theme";

interface Props {
  title: string;
  right?: React.ReactNode;
}

export function SettingsHeader({ title, right }: Props) {
  const nav = useNavigation();
  const colors = useColors();

  return (
    <View
      style={[
        styles.header,
        { borderBottomColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <TouchableOpacity
        onPress={() => nav.goBack()}
        style={styles.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ChevronLeftIcon size={20} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.rightSlot}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  rightSlot: {
    flexDirection: "row",
    alignItems: "center",
  },
});
