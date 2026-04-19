import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
/**
 * ChatScreen — full AI chat matching app-mobile ChatPage layout.
 * Sliding sidebar for threads, compact header, empty state with suggestions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { useStreamingChat } from "@/hooks";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { AttachedQuote } from "@readany/core/types";
import {
  convertToMessageV2,
  formatRelativeTimeShort,
  getMonthLabel,
  groupThreadsByTime,
  mergeMessagesWithStreaming,
} from "@readany/core/utils";
import { Alert } from "react-native";

import { ChatInput } from "@/components/chat/ChatInput";
import { ContextPopover } from "@/components/chat/ContextPopover";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import {
  BookOpenIcon,
  HistoryIcon,
  LibraryIcon,
  LightbulbIcon,
  MessageCirclePlusIcon,
  ScrollTextIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import {
  fontSize as fs,
  fontWeight as fw,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

const THINK_PNG = require("../../assets/think.png");
const THINK_DARK_PNG = require("../../assets/think-dark.png");

export function ChatScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const layout = useResponsiveLayout();
  const isTabletLandscape = layout.isTabletLandscape;
  const sidebarWidth = isTabletLandscape ? Math.min(360, layout.width * 0.28) : Math.min(layout.width * 0.75, 300);
  const s = useMemo(
    () =>
      makeStyles(colors, {
        isTabletLandscape,
        sidebarWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, isTabletLandscape, layout.horizontalPadding, sidebarWidth],
  );

  // Thread sidebar
  const [showSidebar, setShowSidebar] = useState(false);
  const sidebarAnim = useRef(new Animated.Value(-sidebarWidth)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isTabletLandscape) {
      setShowSidebar(false);
      sidebarAnim.setValue(0);
      backdropAnim.setValue(0);
      return;
    }

    sidebarAnim.setValue(showSidebar ? 0 : -sidebarWidth);
  }, [backdropAnim, isTabletLandscape, showSidebar, sidebarAnim, sidebarWidth]);

  const openSidebar = useCallback(() => {
    if (isTabletLandscape) return;
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
  }, [backdropAnim, isTabletLandscape, sidebarAnim]);

  const closeSidebar = useCallback(() => {
    if (isTabletLandscape) return;
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: -sidebarWidth,
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
  }, [backdropAnim, isTabletLandscape, sidebarAnim, sidebarWidth]);

  // Chat store
  const {
    threads,
    generalActiveThreadId,
    loadAllThreads,
    removeThread,
    setGeneralActiveThread,
    getThreadsForContext,
    initialized,
  } = useChatStore();

  useEffect(() => {
    if (!initialized) loadAllThreads();
  }, [initialized, loadAllThreads]);

  const generalThreads = useMemo(() => getThreadsForContext(), [threads, getThreadsForContext]);

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

  // Streaming chat
  const { isStreaming, currentMessage, currentStep, error, sendMessage, stopStream } =
    useStreamingChat();

  // Messages - compute directly without useMemo to ensure reactivity
  const activeThread = generalActiveThreadId
    ? threads.find((th) => th.id === generalActiveThreadId)
    : null;

  const displayMessages = convertToMessageV2(activeThread?.messages || []);
  const allMessages = mergeMessagesWithStreaming(displayMessages, currentMessage, isStreaming);

  // Handlers
  const handleSend = useCallback(
    async (text: string, deepThinking: boolean, spoilerFree: boolean, quotes?: AttachedQuote[]) => {
      // Validate AI config before sending
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

      await sendMessage(
        text,
        undefined,
        deepThinking,
        spoilerFree,
        quotes,
        resolvedAIConfig,
      );
    },
    [sendMessage, navigation, t],
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

  const formatTime = useCallback((ts: number) => formatRelativeTimeShort(ts, t), [t]);

  const groupedThreads = useMemo(() => {
    const grouped = groupThreadsByTime(generalThreads);
    const sections: { key: string; label: string; threads: typeof generalThreads }[] = [
      { key: "today", label: t("chat.today", "今天"), threads: grouped.today },
      { key: "yesterday", label: t("chat.yesterday", "昨天"), threads: grouped.yesterday },
      { key: "last7Days", label: t("chat.last7Days", "7 天内"), threads: grouped.last7Days },
      { key: "last30Days", label: t("chat.last30Days", "30 天内"), threads: grouped.last30Days },
    ];

    const olderByMonth = new Map<string, typeof generalThreads>();
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
  }, [generalThreads, t]);

  const renderSidebarContent = useCallback(
    (closable: boolean) => (
      <>
        <View style={s.sidebarHeader}>
          <Text style={s.sidebarTitle}>{t("chat.history", "历史记录")}</Text>
          {closable ? (
            <TouchableOpacity style={s.iconBtn} onPress={closeSidebar}>
              <XIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.newChatBtn} onPress={handleNewThread} activeOpacity={0.75}>
              <MessageCirclePlusIcon size={15} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {generalThreads.length === 0 ? (
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
        </ScrollView>
      </>
    ),
    [closeSidebar, colors.foreground, colors.mutedForeground, formatTime, generalActiveThreadId, generalThreads.length, groupedThreads, handleNewThread, handleSelectThread, removeThread, s, t],
  );

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.shell}>
        {isTabletLandscape && (
          <View style={[s.sidebarDocked, { paddingTop: insets.top }]}>
            {renderSidebarContent(false)}
          </View>
        )}

        <View style={s.mainColumn}>
          {/* Header — compact, matching mobile */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              {!isTabletLandscape && (
                <TouchableOpacity style={s.iconBtn} onPress={openSidebar} activeOpacity={0.7}>
                  <HistoryIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              )}
            </View>
            <View style={s.headerRight}>
              <ModelSelector onNavigateToSettings={() => navigation.navigate("AISettings")} />
              <ContextPopover />
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
                />
              ) : (
                <EmptyState
                  colors={colors}
                  onSuggestionPress={handleSend}
                  compact={isTabletLandscape}
                />
              )}
            </View>
            <ChatInput onSend={handleSend} onStop={stopStream} isStreaming={isStreaming} />
          </KeyboardAvoidingView>
        </View>
      </View>

      {/* Error */}
      {error && (
        <View style={s.errorBanner}>
          <Text style={s.errorText} numberOfLines={2}>
            {error.message}
          </Text>
        </View>
      )}

      {/* Thread sidebar overlay */}
      {showSidebar && !isTabletLandscape && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} pointerEvents="box-none">
          <Animated.View style={[s.sidebarBackdrop, { opacity: backdropAnim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>
          <Animated.View
            style={[
              s.sidebar,
              { paddingTop: insets.top, transform: [{ translateX: sidebarAnim }] },
            ]}
          >
            {renderSidebarContent(true)}
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function EmptyState({
  colors,
  onSuggestionPress,
  compact = false,
}: {
  colors: ThemeColors;
  onSuggestionPress: (text: string, deepThinking: boolean, spoilerFree: boolean) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const s = useMemo(
    () => makeStyles(colors, { isTabletLandscape: false, sidebarWidth: 0, horizontalPadding: 16 }),
    [colors],
  );

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
        icon: <LibraryIcon size={18} color={colors.mutedForeground} />,
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
    <View style={[s.emptyContainer, compact && s.emptyContainerCompact]}>
      <View style={s.emptyInner}>
        <Image source={isDark ? THINK_DARK_PNG : THINK_PNG} style={{ width: 140, height: 140 }} />
        <Text style={s.emptyTitle}>{t("chat.howCanIHelp", "有什么我可以帮你的？")}</Text>
        <Text style={s.emptySubtitle}>
          {t("chat.askAboutBooks", "关于书籍的任何问题都可以问我")}
        </Text>
      </View>
      <View style={s.suggestionsGrid}>
        {suggestions.map(({ icon, text }) => (
          <TouchableOpacity
            key={text}
            style={s.suggestionCard}
            onPress={() => onSuggestionPress(text, false, false)}
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

const makeStyles = (
  colors: ThemeColors,
  layout: { isTabletLandscape: boolean; sidebarWidth: number; horizontalPadding: number },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    shell: { flex: 1, flexDirection: layout.isTabletLandscape ? "row" : "column" },
    sidebarDocked: {
      width: layout.sidebarWidth,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    mainColumn: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 44,
      paddingHorizontal: layout.isTabletLandscape ? 20 : 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      zIndex: 10,
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
    emptyContainerCompact: {
      paddingHorizontal: 52,
      gap: 24,
    },
    emptyInner: {
      alignItems: "center",
      gap: 8,
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
      backgroundColor: withOpacity(colors.destructive, 0.9),
      borderRadius: radius.lg,
      padding: 12,
    },
    errorText: {
      fontSize: fs.sm,
      color: colors.primaryForeground,
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
      width: layout.sidebarWidth,
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
    newChatBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.muted, 0.72),
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
