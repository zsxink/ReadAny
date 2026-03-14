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
  Pressable,
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
import { useStreamingChat } from "@readany/core/hooks";
import type { AttachedQuote } from "@readany/core/types";
import type { MessageV2 } from "@readany/core/types/message";
import { convertToMessageV2, mergeMessagesWithStreaming, groupThreadsByTime, getMonthLabel, formatRelativeTimeShort } from "@readany/core/utils";

import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import {
  ChevronLeftIcon,
  HistoryIcon,
  MessageCirclePlusIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { fontSize as fs, fontWeight as fw, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

const THINK_PNG = require("../../assets/think.png");

const SCREEN_WIDTH = Dimensions.get("window").width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.75, 300);

type Props = NativeStackScreenProps<RootStackParamList, "BookChat">;

export function BookChatScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { books } = useLibraryStore();
  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

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
    async (text: string, deepThinking: boolean, quotes?: AttachedQuote[]) => {
      const state = useSettingsStore.getState();
      const { aiConfig, getActiveEndpoint, getEndpointById } = state;
      let endpoint = await getActiveEndpoint();
      let model = aiConfig.activeModel;

      // 如果当前端点无 apiKey 或无 activeModel，尝试自动选择一个可用的
      if (!endpoint?.apiKey || !model) {
        // 遍历所有端点，找到第一个有 apiKey 的
        for (const ep of aiConfig.endpoints) {
          const epWithKey = await getEndpointById(ep.id);
          if (epWithKey?.apiKey && ep.models.length > 0) {
            state.setActiveEndpoint(ep.id);
            state.setActiveModel(ep.models[0]);
            endpoint = epWithKey;
            model = ep.models[0];
            break;
          }
        }
      }

      if (!endpoint?.apiKey || !model) {
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
      await sendMessage(text, bookId, deepThinking, quotes);
    },
    [sendMessage, bookId, navigation, t],
  );

  const handleNewThread = useCallback(async () => {
    if (activeThread && activeThread.messages.length === 0) return;
    await createThread(bookId);
  }, [bookId, activeThread, createThread]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setBookActiveThread(bookId, threadId);
      closeSidebar();
    },
    [bookId, setBookActiveThread, closeSidebar],
  );

  const formatTime = useCallback(
    (ts: number) => formatRelativeTimeShort(ts, t),
    [t],
  );

  const groupedThreads = useMemo(() => {
    const grouped = groupThreadsByTime(bookThreads);
    const sections: { key: string; label: string; threads: typeof bookThreads }[] = [
      { key: "today", label: t("chat.today", "今天"), threads: grouped.today },
      { key: "yesterday", label: t("chat.yesterday", "昨天"), threads: grouped.yesterday },
      { key: "last7Days", label: t("chat.last7Days", "7 天内"), threads: grouped.last7Days },
      { key: "last30Days", label: t("chat.last30Days", "30 天内"), threads: grouped.last30Days },
    ];

    const olderByMonth = new Map<string, typeof bookThreads>();
    for (const thread of grouped.older) {
      const monthLabel = getMonthLabel(thread.updatedAt);
      if (!olderByMonth.has(monthLabel)) {
        olderByMonth.set(monthLabel, []);
      }
      olderByMonth.get(monthLabel)!.push(thread);
    }
    const sortedMonths = [...olderByMonth.keys()].sort((a, b) => b.localeCompare(a));
    for (const month of sortedMonths) {
      sections.push({ key: month, label: month, threads: olderByMonth.get(month)! });
    }

    return sections;
  }, [bookThreads, t]);

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
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={s.content}>
            {allMessages.length > 0 ? (
              <MessageList
                messages={allMessages}
                isStreaming={isStreaming}
                currentStep={currentStep}
              />
            ) : (
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
                      onPress={() => handleSend(text, false)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.suggestionText}>{text}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
        <ChatInput
          onSend={handleSend}
          onStop={stopStream}
          isStreaming={isStreaming}
          placeholder={t("chat.askAboutBook", "询问关于这本书的问题...")}
        />
      </KeyboardAvoidingView>

      {/* Thread sidebar overlay */}
      {showSidebar && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Animated.View style={[s.sidebarBackdrop, { opacity: backdropAnim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>
          <Animated.View
            style={[
              s.sidebar,
              { paddingTop: insets.top, transform: [{ translateX: sidebarAnim }] },
            ]}
          >
            <View style={s.sidebarHeader}>
              <Text style={s.sidebarTitle}>{t("chat.history", "历史记录")}</Text>
              <TouchableOpacity style={s.iconBtn} onPress={closeSidebar}>
                <XIcon size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            {bookThreads.length === 0 ? (
              <View style={s.sidebarEmpty}>
                <Text style={s.sidebarEmptyText}>{t("chat.noConversations", "暂无对话")}</Text>
              </View>
            ) : (
              groupedThreads.map(({ key, label, threads }) => {
                if (threads.length === 0) return null;
                return (
                  <View key={key}>
                    <Text style={s.sectionLabel}>{label}</Text>
                    {threads.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      const lastMsg =
                        thread.messages.length > 0 ? thread.messages[thread.messages.length - 1] : null;
                      const preview = lastMsg?.content?.slice(0, 60) || "";
                      return (
                        <TouchableOpacity
                          key={thread.id}
                          style={[s.threadItem, isActive && s.threadItemActive]}
                          onPress={() => handleSelectThread(thread.id)}
                          activeOpacity={0.7}
                        >
                          <View style={s.threadContent}>
                            <View style={s.threadTitleRow}>
                              <Text
                                style={[s.threadTitle, isActive && s.threadTitleActive]}
                                numberOfLines={1}
                              >
                                {thread.title || t("chat.newChat", "新对话")}
                              </Text>
                              <Text style={s.threadTime}>{formatTime(thread.updatedAt)}</Text>
                            </View>
                            {preview ? (
                              <Text style={s.threadPreview} numberOfLines={1}>
                                {preview}
                              </Text>
                            ) : null}
                          </View>
                          <TouchableOpacity
                            style={s.threadDeleteBtn}
                            onPress={() => removeThread(thread.id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Trash2Icon size={12} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })
            )}
          </Animated.View>
        </View>
      )}
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
