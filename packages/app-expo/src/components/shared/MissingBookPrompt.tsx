import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
} from "@/styles/theme";
import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export function MissingBookPrompt() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { visible, title, description, confirmLabel, cancelLabel, resolvePrompt } =
    useMissingBookPromptStore();

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => resolvePrompt(false)}>
      <Pressable style={styles.overlay} onPress={() => resolvePrompt(false)}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => resolvePrompt(false)} activeOpacity={0.8}>
              <Text style={styles.secondaryText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => resolvePrompt(true)} activeOpacity={0.85}>
              <Text style={styles.primaryText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.32)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    card: {
      width: "100%",
      maxWidth: 328,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      gap: spacing.md,
    },
    title: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 24,
    },
    description: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    secondaryButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.xl,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    primaryButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.xl,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
  });
