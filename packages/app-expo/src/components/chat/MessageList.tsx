/**
 * MessageList — FlatList message renderer matching app-mobile MessageList.
 * Scroll-to-bottom button, streaming gap indicator.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { MessageV2, QuotePart, TextPart } from "@readany/core/types/message";
import { useColors, fontSize as fs, radius, fontWeight as fw } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { PartRenderer } from "./PartRenderer";
import { StreamingIndicator } from "./StreamingIndicator";
import { ChevronDownIcon } from "@/components/ui/Icon";

interface MessageListProps {
  messages: MessageV2[];
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
}

const BOTTOM_THRESHOLD = 80;

export function MessageList({
  messages,
  isStreaming,
  currentStep,
}: MessageListProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const flatListRef = useRef<FlatList>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (isAtBottom && flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, isAtBottom]);

  // Periodic scroll during streaming
  useEffect(() => {
    if (!isStreaming || !isAtBottom) return;
    const interval = setInterval(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 300);
    return () => clearInterval(interval);
  }, [isStreaming, isAtBottom]);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height <
      BOTTOM_THRESHOLD;
    setIsAtBottom(nearBottom);
    setShowScrollDown(!nearBottom);
  }, []);

  const handleScrollToBottom = useCallback(() => {
    setIsAtBottom(true);
    setShowScrollDown(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const renderMessage = useCallback(
    ({ item, index }: { item: MessageV2; index: number }) => {
      const isLastMsg = index === messages.length - 1;
      const isLastMsgStreaming =
        isStreaming && isLastMsg && item.role === "assistant" && item.parts.length > 0;

      return (
        <MessageBubble
          message={item}
          colors={colors}
          isStreaming={isLastMsgStreaming}
          currentStep={currentStep}
        />
      );
    },
    [colors, messages.length, isStreaming, currentStep],
  );

  // Show indicator when streaming but no assistant content yet
  const lastMsg = messages[messages.length - 1];
  const showStreamingIndicator =
    isStreaming &&
    currentStep &&
    currentStep !== "idle" &&
    (!lastMsg || lastMsg.role !== "assistant" || lastMsg.parts.length === 0);

  return (
    <View style={s.container}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={s.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          showStreamingIndicator ? (
            <StreamingIndicator step={currentStep!} />
          ) : null
        }
      />

      {/* Scroll to bottom button */}
      {showScrollDown && (
        <View style={s.scrollDownWrap}>
          <TouchableOpacity
            style={s.scrollDownBtn}
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
          >
            <ChevronDownIcon size={14} color={colors.mutedForeground} />
            <Text style={s.scrollDownText}>
              {t("streaming.scrollToBottom", "滚动到底部")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function UserQuoteBlock({ part, colors }: { part: QuotePart; colors: ThemeColors }) {
  return (
    <View style={quoteStyles(colors).quoteBlock}>
      <View style={{ flex: 1 }}>
        <Text style={quoteStyles(colors).quoteText} numberOfLines={4}>
          {part.text.length > 200 ? `${part.text.slice(0, 200)}...` : part.text}
        </Text>
        {part.source && (
          <Text style={quoteStyles(colors).quoteSource}>— {part.source}</Text>
        )}
      </View>
    </View>
  );
}

const quoteStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    quoteBlock: {
      flexDirection: "row",
      gap: 6,
      borderRadius: radius.md,
      backgroundColor: "rgba(99,102,241,0.05)",
      borderWidth: 0.5,
      borderColor: "rgba(99,102,241,0.15)",
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    quoteText: {
      fontSize: fs.xs,
      lineHeight: 16,
      color: colors.foreground,
      opacity: 0.8,
    },
    quoteSource: {
      fontSize: fs.xs - 1,
      color: colors.mutedForeground,
      marginTop: 2,
    },
  });

interface MessageBubbleProps {
  message: MessageV2;
  colors: ThemeColors;
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
}

function MessageBubble({ message, colors, isStreaming, currentStep }: MessageBubbleProps) {
  const s = makeStyles(colors);

  if (message.role === "user") {
    const quoteParts = message.parts.filter((p) => p.type === "quote") as QuotePart[];
    const textParts = message.parts.filter((p) => p.type === "text") as TextPart[];

    return (
      <View style={s.userRow}>
        <View style={s.userBubble}>
          {quoteParts.length > 0 && (
            <View style={{ gap: 4, marginBottom: textParts.length > 0 ? 6 : 0 }}>
              {quoteParts.map((q) => (
                <UserQuoteBlock key={q.id} part={q} colors={colors} />
              ))}
            </View>
          )}
          {textParts.map((part) => (
            <Text key={part.id} style={s.userText}>
              {part.text}
            </Text>
          ))}
        </View>
      </View>
    );
  }

  // Assistant message
  const hasContent = message.parts.some(
    (p) => (p.type === "text" && (p as TextPart).text.trim()) || p.type !== "text",
  );
  if (!hasContent) return null;

  // Show gap indicator between parts when streaming
  const lastPart = message.parts[message.parts.length - 1];
  const isLastPartRunningText = lastPart?.type === "text" && lastPart.status === "running";
  const isLastPartActiveToolCall =
    lastPart?.type === "tool_call" &&
    (lastPart.status === "pending" || lastPart.status === "running");
  const showGapIndicator =
    isStreaming &&
    currentStep !== "idle" &&
    lastPart &&
    !isLastPartRunningText &&
    !isLastPartActiveToolCall;

  return (
    <View style={s.assistantRow}>
      {message.parts.map((part) => (
        <PartRenderer key={part.id} part={part} />
      ))}
      {showGapIndicator && <StreamingIndicator step="thinking" />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    userRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: 16,
    },
    userBubble: {
      maxWidth: "85%",
      backgroundColor: colors.muted,
      borderRadius: radius.xl + 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    userText: {
      fontSize: fs.sm,
      lineHeight: 20,
      color: colors.foreground,
    },
    assistantRow: {
      gap: 4,
    },
    scrollDownWrap: {
      position: "absolute",
      bottom: 8,
      left: 0,
      right: 0,
      alignItems: "center",
    },
    scrollDownBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
    },
    scrollDownText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
  });
