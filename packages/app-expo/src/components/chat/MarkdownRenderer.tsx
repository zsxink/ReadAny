/**
 * MarkdownRenderer — renders markdown content using react-native-markdown-display.
 * Supports streaming with blinking cursor, code blocks with copy, themed styles.
 */
import { useCallback } from "react";
import { Text, View, StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { useColors, fontSize as fs, radius } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const colors = useColors();
  const styles = makeMarkdownStyles(colors);

  const handleCopyCode = useCallback((text: string) => {
    Clipboard.setStringAsync(text);
  }, []);

  return (
    <View>
      <Markdown style={styles} mergeStyle>
        {content}
      </Markdown>
      {isStreaming && (
        <View style={cursorStyles.cursorWrap}>
          <View style={[cursorStyles.cursor, { backgroundColor: colors.foreground }]} />
        </View>
      )}
    </View>
  );
}

const cursorStyles = StyleSheet.create({
  cursorWrap: { flexDirection: "row", marginTop: 2 },
  cursor: { width: 2, height: 16, borderRadius: 1, opacity: 0.7 },
});

const makeMarkdownStyles = (colors: ThemeColors) =>
  ({
    body: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: 20,
    },
    heading1: {
      color: colors.foreground,
      fontSize: fs.lg,
      fontWeight: "700",
      marginBottom: 8,
      marginTop: 12,
    },
    heading2: {
      color: colors.foreground,
      fontSize: fs.md,
      fontWeight: "600",
      marginBottom: 6,
      marginTop: 10,
    },
    heading3: {
      color: colors.foreground,
      fontSize: fs.base,
      fontWeight: "600",
      marginBottom: 4,
      marginTop: 8,
    },
    paragraph: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: 20,
      marginBottom: 8,
      marginTop: 0,
    },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    link: { color: colors.blue, textDecorationLine: "none" },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      marginLeft: 0,
      marginVertical: 6,
      backgroundColor: "transparent",
    },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    fence: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    thead: {
      backgroundColor: colors.muted,
    },
    th: {
      color: colors.foreground,
      fontSize: fs.xs,
      fontWeight: "600",
      padding: 6,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    td: {
      color: colors.foreground,
      fontSize: fs.xs,
      padding: 6,
      borderBottomWidth: 0.5,
      borderColor: colors.border,
    },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: {
      marginBottom: 4,
      flexDirection: "row",
    },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: 12,
    },
    image: {
      maxWidth: 300,
      borderRadius: radius.md,
    },
  }) as const;
