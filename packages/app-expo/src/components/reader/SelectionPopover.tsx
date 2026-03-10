/**
 * SelectionPopover — floating action bar shown when text is selected in the reader.
 * Provides highlight (5 colors), copy, AI chat, and TTS actions.
 */
import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import { useTranslation } from "react-i18next";
import type { SelectionEvent } from "@/hooks/use-reader-bridge";
import { useColors, fontSize as fs, radius, spacing, fontWeight as fw } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

const HIGHLIGHT_COLORS = [
  { key: "yellow", hex: "#facc15" },
  { key: "green", hex: "#4ade80" },
  { key: "blue", hex: "#60a5fa" },
  { key: "pink", hex: "#f472b6" },
  { key: "purple", hex: "#c084fc" },
] as const;

const SCREEN_WIDTH = Dimensions.get("window").width;
const POPOVER_WIDTH = SCREEN_WIDTH - 32;
const POPOVER_MARGIN = 16;

interface Props {
  selection: SelectionEvent;
  onHighlight: (color: string) => void;
  onDismiss: () => void;
  onCopy: () => void;
  onAIChat: () => void;
}

export function SelectionPopover({
  selection,
  onHighlight,
  onDismiss,
  onCopy,
  onAIChat,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const top = useMemo(() => {
    const selTop = selection.position.selectionTop;
    const selBottom = selection.position.selectionBottom;
    // Place above selection if there's room, otherwise below
    const popoverHeight = 100;
    if (selTop > popoverHeight + 10) {
      return selTop - popoverHeight - 8;
    }
    return selBottom + 8;
  }, [selection.position]);

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(selection.text);
    onCopy();
  }, [selection.text, onCopy]);

  const handleSpeak = useCallback(() => {
    Speech.speak(selection.text, { language: undefined });
    onDismiss();
  }, [selection.text, onDismiss]);

  return (
    <View style={[s.overlay]} pointerEvents="box-none">
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onDismiss}
      />
      <View style={[s.popover, { top }]}>
        {/* Color row */}
        <View style={s.colorRow}>
          {HIGHLIGHT_COLORS.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[s.colorDot, { backgroundColor: c.hex }]}
              onPress={() => onHighlight(c.key)}
            />
          ))}
        </View>

        {/* Action row */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionBtn} onPress={handleCopy}>
            <Text style={s.actionText}>
              {t("reader.copy", "复制")}
            </Text>
          </TouchableOpacity>
          <View style={s.separator} />
          <TouchableOpacity style={s.actionBtn} onPress={onAIChat}>
            <Text style={s.actionText}>
              {t("reader.aiChat", "AI")}
            </Text>
          </TouchableOpacity>
          <View style={s.separator} />
          <TouchableOpacity style={s.actionBtn} onPress={handleSpeak}>
            <Text style={s.actionText}>
              {t("reader.speak", "朗读")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
    },
    popover: {
      position: "absolute",
      left: POPOVER_MARGIN,
      width: POPOVER_WIDTH,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    colorRow: {
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    colorDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: spacing.sm,
    },
    actionBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.xs,
    },
    actionText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
    },
    separator: {
      width: StyleSheet.hairlineWidth,
      height: 16,
      backgroundColor: colors.border,
    },
  });
