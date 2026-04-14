import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
/**
 * BookChatScreen — book-scoped AI chat, opened from reader AI button.
 * Features: thread sidebar, empty state with suggestions, new thread button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibraryStore } from "@/stores";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { useStreamingChat } from "@/hooks";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import {
  convertToMessageV2,
  mergeMessagesWithStreaming,
} from "@readany/core/utils";

import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import {
  ChevronLeftIcon,
  HistoryIcon,
  MessageCirclePlusIcon,
} from "@/components/ui/Icon";
import { fontSize as fs, fontWeight as fw, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { ThreadSidebar } from "./chat/ThreadSidebar";

const THINK_PNG = require("../../assets/think.png");

const SCREEN_WIDTH = Dimensions.get("window").width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.75, 300);

type Props = NativeStackScreenProps<RootStackParamList, "BookChat">;

export function BookChatScreen({ route, navigation }: Props) {
  const { bookId, selectedText, chapterTitle } = route.params;
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { books } = useLibraryStore();
  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

  // Debug: log received params
  useEffect(() => {
    console.log("[BookChatScreen] params:", { bookId, selectedText, chapterTitle });
  }, [bookId, selectedText, chapterTitle]);

  // Initial quote from reader selection
  const [quotes, setQuotes] = useState<AttachedQuote[]>([]);

  // Initialize quotes when selectedText is available
  useEffect(() => {
    if (selectedText && quotes.length === 0) {
      console.log("[BookChatScreen] Initializing quotes with selectedText:", selectedText);
      setQuotes([
        {
          id: `quote-${Date.now()}`,
          text: selectedText,
          source: chapterTitle || undefined,
        },
      ]);
    }
  }, [selectedText, chapterTitle, quotes.length]);

  const handleRemoveQuote = useCallback((id: string) => {
    setQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const {
    threads,
    loadThreads,
    getActiveThreadId,
    setBookActiveThread,
    createThread,
    removeThread,
    getThreadsForContext,
  } = useChatStore();

  useEffect(() => {
    loadThreads(bookId);
  }, [bookId, loadThreads]);

  const activeThreadId = getActiveThreadId(bookId);
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((t) => t.id === activeThreadId) : null),
    [threads, activeThreadId],
  );
  const bookThreads = useMemo(
    () => getThreadsForContext(bookId),
    [threads, getThreadsForContext, bookId],
  );

  // Sidebar animation
  const [showSidebar, setShowSidebar] = useState(false);
  const sidebarAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const openSidebar = useCallback(() => {
    setShowSidebar(true);
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [sidebarAnim, backdropAnim]);

  const closeSidebar = useCallback(() => {
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: -SIDEBAR_WIDTH,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setShowSidebar(false));
  }, [sidebarAnim, backdropAnim]);

  // Streaming chat
  const { isStreaming, currentMessage, currentStep, error, sendMessage, stopStream } =
    useStreamingChat({ book, bookId });

  // Listen for keyboard events to fix scroll issues
  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardDidShow" : "keyboardDidShow",
      () => {
        // Scroll to bottom when keyboard shows
        setTimeout(() => {
          // This will be handled by MessageList component
        }, 100);
      },
    );
    const keyboardDidHide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardDidHide" : "keyboardDidHide",
      () => {
        // Ensure proper layout after keyboard hides
        setTimeout(() => {
          // This will be handled by MessageList component
        }, 100);
      },
    );

    return () => {
      keyboardDidShow.remove();
      keyboardDidHide.remove();
    };
  }, []);

  const messagesV2: MessageV2[] = useMemo(() => {
    if (!activeThread) return [];
    return convertToMessageV2(activeThread.messages);
  }, [activeThread?.messages]);

  const allMessages = useMemo(
    () => mergeMessagesWithStreaming(messagesV2, currentMessage, isStreaming),
    [messagesV2, currentMessage, isStreaming],
  );

  // Handlers
  const handleSend = useCallback(
    async (text: string, deepThinking: boolean, spoilerFree: boolean, quotes?: AttachedQuote[]) => {
      const state = useSettingsStore.getState();
      const resolvedAIConfig = await resolveActiveAIConfig(state);

      if (!resolvedAIConfig) {
        Alert.alert(
          t("chat.configRequired", "需要配置 AI"),
          t("chat.configRequiredMessage", "请先在设置中配置 AI 端点和模型"),
          [
            { text: t("common.cancel", "取消"), style: "cancel" },
            {
              text: t("common.settings", "去设置"),
              onPress: () => navigation.navigate("AISettings"),
            },
          ],
        );
        return;
      }
      await sendMessage(text, bookId, deepThinking, spoilerFree, quotes, resolvedAIConfig);
    },
    [sendMessage, bookId, navigation, t],
  );

  const handleNewThread = useCallback(async () => {
    if (activeThread && activeThread.messages.length === 0) return;
    await createThread(bookId);
  }, [bookId, activeThread, createThread]);

  const handleCitationClick = useCallback(
    (citation: CitationPart) => {
      if (citation.bookId === bookId && citation.cfi) {
        navigation.navigate("Reader", { bookId, cfi: citation.cfi, highlight: true });
      } else if (citation.bookId) {
        navigation.navigate("Reader", {
          bookId: citation.bookId,
          cfi: citation.cfi,
          highlight: true,
        });
      }
    },
    [bookId, navigation],
  );

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setBookActiveThread(bookId, threadId);
      closeSidebar();
    },
    [bookId, setBookActiveThread, closeSidebar],
  );

  const SUGGESTIONS = useMemo(
    () => [
      t("chat.suggestions.summarizeChapter"),
      t("chat.suggestions.explainConcepts"),
      t("chat.suggestions.analyzeAuthor"),
    ],
    [t],
  );

  return (
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <ChevronLeftIcon size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={openSidebar} activeOpacity={0.7}>
            <HistoryIcon size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <Text style={s.headerTitle} numberOfLines={1}>
          {t("chat.aiAssistant", "AI 助手")}
        </Text>

        <View style={s.headerRight}>
          <ModelSelector onNavigateToSettings={() => navigation.navigate("AISettings")} />
          <TouchableOpacity style={s.iconBtn} onPress={handleNewThread} activeOpacity={0.7}>
            <MessageCirclePlusIcon size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={s.content}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={s.content}>
          {allMessages.length > 0 ? (
            <MessageList
              messages={allMessages}
              isStreaming={isStreaming}
              currentStep={currentStep}
              onCitationClick={handleCitationClick}
            />
          ) : (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={s.emptyContainer}>
                <View style={s.emptyInner}>
                  <Image source={THINK_PNG} style={{ width: 120, height: 120 }} />
                  <Text style={s.emptyTitle}>{t("chat.aiAssistant", "AI 阅读助手")}</Text>
                  <Text style={s.emptySubtitle}>
                    {t("chat.aiAssistantDesc", "分析内容、回答问题...")}
                  </Text>
                </View>
                <View style={s.suggestionsContainer}>
                  {SUGGESTIONS.map((text) => (
                    <TouchableOpacity
                      key={text}
                      style={s.suggestionCard}
                      onPress={() => handleSend(text, false, false)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.suggestionText}>{text}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </TouchableWithoutFeedback>
          )}
        </View>
        <ChatInput
          onSend={handleSend}
          onStop={stopStream}
          isStreaming={isStreaming}
          placeholder={t("chat.askAboutBook", "询问关于这本书的问题...")}
          quotes={quotes}
          onRemoveQuote={handleRemoveQuote}
        />
      </KeyboardAvoidingView>

      <ThreadSidebar
        visible={showSidebar}
        threads={bookThreads}
        activeThreadId={activeThreadId}
        sidebarAnim={sidebarAnim}
        backdropAnim={backdropAnim}
        insetTop={insets.top}
        onClose={closeSidebar}
        onSelectThread={handleSelectThread}
        onRemoveThread={removeThread}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 48,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      zIndex: 10,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    headerTitle: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
      textAlign: "center",
      maxWidth: "50%",
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    content: { flex: 1 },

    // Empty state
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      gap: 24,
    },
    emptyInner: {
      alignItems: "center",
      gap: 8,
    },
    emptyTitle: {
      fontSize: fs.lg,
      fontWeight: fw.semibold,
      color: colors.foreground,
      marginTop: 4,
    },
    emptySubtitle: {
      fontSize: fs.sm,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    suggestionsContainer: {
      gap: 6,
    },
    suggestionCard: {
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    suggestionText: {
      fontSize: fs.sm,
      color: colors.foreground,
    },

    // Sidebar
    sidebarBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.2)",
    },
    sidebar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: SIDEBAR_WIDTH,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
      shadowColor: "#000",
      shadowOffset: { width: 2, height: 0 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
    sidebarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    sidebarTitle: {
      fontSize: fs.sm,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    sidebarEmpty: {
      paddingVertical: 40,
      alignItems: "center",
    },
    sidebarEmptyText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    threadItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    threadItemActive: {
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    threadContent: {
      flex: 1,
      gap: 2,
    },
    threadTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    threadTitle: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
      flex: 1,
    },
    threadTitleActive: {
      color: colors.primary,
    },
    threadTime: {
      fontSize: 11,
      color: colors.mutedForeground,
      opacity: 0.5,
    },
    threadPreview: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    threadDeleteBtn: {
      marginTop: 2,
      padding: 4,
    },
  });
