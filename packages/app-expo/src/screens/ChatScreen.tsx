/**
 * ChatScreen — full AI chat matching app-mobile ChatPage layout.
 * Sliding sidebar for threads, compact header, empty state with suggestions.
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";

import { useStreamingChat } from "@readany/core/hooks/use-streaming-chat";
import { useChatStore } from "@/stores/chat-store";
import { convertToMessageV2, mergeMessagesWithStreaming } from "@readany/core/utils/chat-utils";
import type { MessageV2 } from "@readany/core/types/message";
import type { AttachedQuote, Thread } from "@readany/core/types";

import { useColors, fontSize as fs, radius, fontWeight as fw } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ModelSelector } from "@/components/chat/ModelSelector";
import {
  MessageCirclePlusIcon,
  HistoryIcon,
  BrainIcon,
  ScrollTextIcon,
  LightbulbIcon,
  SearchIcon,
  BookOpenIcon,
  XIcon,
  Trash2Icon,
} from "@/components/ui/Icon";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.75, 300);

export function ChatScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Thread sidebar
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

  // Chat store
  const {
    threads,
    generalActiveThreadId,
    loadAllThreads,
    createThread,
    removeThread,
    setGeneralActiveThread,
    getThreadsForContext,
    initialized,
  } = useChatStore();

  useEffect(() => {
    if (!initialized) loadAllThreads();
  }, [initialized, loadAllThreads]);

  const generalThreads = useMemo(
    () => getThreadsForContext(),
    [threads, getThreadsForContext],
  );

  const activeThread = useMemo(
    () =>
      generalActiveThreadId
        ? threads.find((th) => th.id === generalActiveThreadId)
        : null,
    [threads, generalActiveThreadId],
  );

  // Streaming chat
  const {
    isStreaming,
    currentMessage,
    currentStep,
    error,
    sendMessage,
    stopStream,
  } = useStreamingChat();

  // Messages
  const storeMessages: MessageV2[] = useMemo(() => {
    if (!activeThread) return [];
    return convertToMessageV2(activeThread.messages);
  }, [activeThread?.messages]);

  const allMessages = useMemo(
    () => mergeMessagesWithStreaming(storeMessages, currentMessage, isStreaming),
    [storeMessages, currentMessage, isStreaming],
  );

  // Handlers
  const handleSend = useCallback(
    async (text: string, deepThinking: boolean, quotes?: AttachedQuote[]) => {
      if (!generalActiveThreadId) {
        await createThread(undefined, text.slice(0, 50));
        setTimeout(() => sendMessage(text, undefined, deepThinking, quotes), 50);
      } else {
        await sendMessage(text, undefined, deepThinking, quotes);
      }
    },
    [sendMessage, generalActiveThreadId, createThread],
  );

  const handleNewThread = useCallback(() => {
    setGeneralActiveThread(null);
    closeSidebar();
  }, [setGeneralActiveThread, closeSidebar]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setGeneralActiveThread(threadId);
      closeSidebar();
    },
    [setGeneralActiveThread, closeSidebar],
  );

  const formatTime = useCallback(
    (ts: number) => {
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return t("chat.justNow", "刚刚");
      if (mins < 60) return `${mins}m`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}d`;
      return `${Math.floor(days / 30)}mo`;
    },
    [t],
  );

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* Header — compact, matching mobile */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={openSidebar}
            activeOpacity={0.7}
          >
            <HistoryIcon size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <View style={s.headerRight}>
          <ModelSelector
            onNavigateToSettings={() => navigation.navigate("AISettings")}
          />
          <TouchableOpacity
            style={s.iconBtn}
            onPress={handleNewThread}
            activeOpacity={0.7}
          >
            <MessageCirclePlusIcon size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={s.content}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 44}
      >
        {allMessages.length > 0 ? (
          <MessageList
            messages={allMessages}
            isStreaming={isStreaming}
            currentStep={currentStep}
          />
        ) : (
          <EmptyState colors={colors} onSuggestionPress={handleSend} />
        )}
        <ChatInput
          onSend={handleSend}
          onStop={stopStream}
          isStreaming={isStreaming}
        />
      </KeyboardAvoidingView>

      {/* Error */}
      {error && (
        <View style={s.errorBanner}>
          <Text style={s.errorText} numberOfLines={2}>
            {error.message}
          </Text>
        </View>
      )}

      {/* Thread sidebar overlay */}
      {showSidebar && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Animated.View
            style={[
              s.sidebarBackdrop,
              { opacity: backdropAnim },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeSidebar}
            />
          </Animated.View>
          <Animated.View
            style={[
              s.sidebar,
              { paddingTop: insets.top, transform: [{ translateX: sidebarAnim }] },
            ]}
          >
            <View style={s.sidebarHeader}>
              <Text style={s.sidebarTitle}>
                {t("chat.history", "历史记录")}
              </Text>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={closeSidebar}
              >
                <XIcon size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            {generalThreads.length === 0 ? (
              <View style={s.sidebarEmpty}>
                <Text style={s.sidebarEmptyText}>
                  {t("chat.noConversations", "暂无对话")}
                </Text>
              </View>
            ) : (
              generalThreads.map((thread) => {
                const isActive = thread.id === generalActiveThreadId;
                const lastMsg =
                  thread.messages.length > 0
                    ? thread.messages[thread.messages.length - 1]
                    : null;
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
                          style={[
                            s.threadTitle,
                            isActive && s.threadTitleActive,
                          ]}
                          numberOfLines={1}
                        >
                          {thread.title || t("chat.newChat", "新对话")}
                        </Text>
                        <Text style={s.threadTime}>
                          {formatTime(thread.updatedAt)}
                        </Text>
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
              })
            )}
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function EmptyState({
  colors,
  onSuggestionPress,
}: {
  colors: ThemeColors;
  onSuggestionPress: (text: string, deepThinking: boolean) => void;
}) {
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const suggestions = useMemo(
    () => [
      {
        icon: <ScrollTextIcon size={18} color={colors.mutedForeground} />,
        text: t("chat.suggestions.summarizeReading", "总结最近读过的内容"),
      },
      {
        icon: <LightbulbIcon size={18} color={colors.mutedForeground} />,
        text: t("chat.suggestions.analyzeArguments", "分析文中论点"),
      },
      {
        icon: <SearchIcon size={18} color={colors.mutedForeground} />,
        text: t("chat.suggestions.findConcepts", "查找关键概念"),
      },
      {
        icon: <BookOpenIcon size={18} color={colors.mutedForeground} />,
        text: t("chat.suggestions.generateNotes", "生成阅读笔记"),
      },
    ],
    [t, colors],
  );

  return (
    <View style={s.emptyContainer}>
      <View style={s.emptyInner}>
        <View style={s.emptyBrainWrap}>
          <BrainIcon size={36} color={colors.indigo} />
        </View>
        <Text style={s.emptyTitle}>
          {t("chat.howCanIHelp", "有什么我可以帮你的？")}
        </Text>
        <Text style={s.emptySubtitle}>
          {t("chat.askAboutBooks", "关于书籍的任何问题都可以问我")}
        </Text>
      </View>
      <View style={s.suggestionsGrid}>
        {suggestions.map(({ icon, text }) => (
          <TouchableOpacity
            key={text}
            style={s.suggestionCard}
            onPress={() => onSuggestionPress(text, false)}
            activeOpacity={0.7}
          >
            {icon}
            <Text style={s.suggestionText}>{text}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 44,
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    content: { flex: 1 },

    // Empty state — matching mobile ChatPage
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      gap: 32,
    },
    emptyInner: {
      alignItems: "center",
      gap: 8,
    },
    emptyBrainWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: "rgba(99,102,241,0.1)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    emptyTitle: {
      fontSize: fs.xl,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    emptySubtitle: {
      fontSize: fs.sm,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    suggestionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    suggestionCard: {
      width: "48%",
      flexGrow: 1,
      backgroundColor: colors.muted,
      borderRadius: radius.xl,
      padding: 14,
      gap: 10,
    },
    suggestionText: {
      fontSize: fs.xs,
      lineHeight: 16,
      color: colors.foreground,
    },

    // Error
    errorBanner: {
      position: "absolute",
      bottom: 80,
      left: 16,
      right: 16,
      backgroundColor: "rgba(229,57,53,0.9)",
      borderRadius: radius.lg,
      padding: 12,
    },
    errorText: {
      fontSize: fs.sm,
      color: "#fff",
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
    threadItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    threadItemActive: {
      backgroundColor: "rgba(99,102,241,0.08)",
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
      color: colors.indigo,
    },
    threadTime: {
      fontSize: 9,
      color: colors.mutedForeground,
      opacity: 0.5,
    },
    threadPreview: {
      fontSize: 11,
      color: colors.mutedForeground,
    },
    threadDeleteBtn: {
      marginTop: 2,
      padding: 4,
    },
  });
