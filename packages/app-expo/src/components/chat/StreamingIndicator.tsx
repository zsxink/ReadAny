/**
 * StreamingIndicator — displays thinking/tool_calling/responding status
 * with stop button.
 */
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors, fontSize as fs, radius, fontWeight as fw } from "@/styles/theme";
import { BrainIcon } from "@/components/ui/Icon";

interface StreamingIndicatorProps {
  step: "thinking" | "tool_calling" | "responding";
}

export function StreamingIndicator({ step }: StreamingIndicatorProps) {
  const { t } = useTranslation();
  const colors = useColors();

  const getLabel = () => {
    switch (step) {
      case "thinking":
        return t("streaming.thinking", "正在思考...");
      case "tool_calling":
        return t("streaming.toolCalling", "正在调用工具...");
      case "responding":
        return t("streaming.responding", "正在回复...");
    }
  };

  const getIcon = () => {
    switch (step) {
      case "thinking":
        return <BrainIcon size={14} color={colors.indigo} />;
      default:
        return <ActivityIndicator size="small" color={colors.indigo} />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      {getIcon()}
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        {getLabel()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.lg,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: fs.sm,
    fontWeight: fw.medium,
  },
});
