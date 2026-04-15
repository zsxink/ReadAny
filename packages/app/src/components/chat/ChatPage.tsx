import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
/**
 * ChatPage — standalone full-page chat for general conversations.
 */
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useChatReaderStore } from "@/stores/chat-reader-store";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { CitationPart } from "@readany/core/types";
import {
  convertToMessageV2,
  formatRelativeTimeShort,
  getMonthLabel,
  groupThreadsByTime,
  mergeMessagesWithStreaming,
  providerRequiresApiKey,
} from "@readany/core/utils";
import {
  BookOpen,
  History,
  Library,
  Lightbulb,
  MessageCirclePlus,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { ContextPopover } from "./ContextPopover";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";

function ThreadsSidebar({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const { getThreadsForContext, getActiveThreadId, removeThread } = useChatStore();
  const generalThreads = getThreadsForContext();
  const activeThreadId = getActiveThreadId();

  return (
    <div
      className={`absolute inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${open ? "bg-black/5 opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute left-0 top-0 h-full w-72 transform rounded-r-2xl border-r bg-background px-3 py-3 shadow-lg transition-all duration-300 ease-out flex flex-col ${open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t("chat.history")}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {generalThreads.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("chat.noConversations")}
            </p>
          )}
          {(() => {
            const grouped = groupThreadsByTime(generalThreads);
            const sections: { key: string; label: string; threads: typeof generalThreads }[] = [
              { key: "today", label: t("chat.today"), threads: grouped.today },
              { key: "yesterday", label: t("chat.yesterday"), threads: grouped.yesterday },
              { key: "last7Days", label: t("chat.last7Days"), threads: grouped.last7Days },
              { key: "last30Days", label: t("chat.last30Days"), threads: grouped.last30Days },
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

            return sections.map(({ key, label, threads }) => {
              if (threads.length === 0) return null;
              return (
                <div key={key} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {label}
                  </div>
                  {threads.map((thread) => {
                    const lastMsg =
                      thread.messages.length > 0
                        ? thread.messages[thread.messages.length - 1]
                        : null;
                    const preview = lastMsg?.content?.slice(0, 80) || "";
                    return (
                      <div
                        key={thread.id}
                        onClick={() => {
                          onSelect(thread.id);
                          onClose();
                        }}
                        className={`group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 transition-colors ${thread.id === activeThreadId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {thread.title || t("chat.newChat")}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/50">
                              {formatRelativeTimeShort(thread.updatedAt, t)}
                            </span>
                          </div>
                          {preview && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {preview}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeThread(thread.id);
                          }}
                          className="mt-0.5 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const { t } = useTranslation();
  const SUGGESTIONS = [
    { key: "chat.suggestions.summarizeReading", icon: ScrollText },
    { key: "chat.suggestions.analyzeArguments", icon: Lightbulb },
    { key: "chat.suggestions.findConcepts", icon: Library },
    { key: "chat.suggestions.generateNotes", icon: BookOpen },
  ] as const;

  return (
    <div className="flex h-full w-full select-none items-center justify-center overflow-y-auto p-6">
      <div className="flex items-center gap-12">
        <img src="/think.svg" alt="" className="h-52 w-52 shrink-0 dark:invert" />
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t("chat.howCanIHelp")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("chat.askAboutBooks")}</p>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              {t("chat.getStarted")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {SUGGESTIONS.map(({ key, icon: Icon }) => (
                <div
                  key={key}
                  onClick={() => onSuggestionClick(t(key))}
                  className="flex cursor-pointer flex-col items-start gap-3 rounded-xl bg-muted/70 p-4 transition-colors hover:bg-muted"
                >
                  <Icon className="size-5 text-muted-foreground" />
                  <span className="text-sm text-foreground">{t(key)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const {
    threads,
    loadAllThreads,
    initialized,
    createThread,
    setGeneralActiveThread,
    getActiveThreadId,
  } = useChatStore();
  const { bookTitle } = useChatReaderStore();

  // /chats page should only use general threads - always pass undefined for bookId
  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat();

  const [showThreads, setShowThreads] = useState(false);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);

  useEffect(() => {
    if (!initialized) {
      loadAllThreads();
    }
  }, [initialized, loadAllThreads]);

  const activeThreadId = getActiveThreadId();
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const handleSend = useCallback(
    async (content: string, deepThinking = false, spoilerFree = false) => {
      const { aiConfig } = useSettingsStore.getState();
      const endpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
      const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
      if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
        setConfigGuide("ai");
        return;
      }

      // /chats page should only use general threads (no bookId)
      if (!activeThreadId) {
        await createThread(undefined, content.slice(0, 50));
        setTimeout(() => sendMessage(content, undefined, deepThinking, spoilerFree), 50);
      } else {
        sendMessage(content, undefined, deepThinking, spoilerFree);
      }
    },
    [activeThreadId, createThread, sendMessage],
  );

  const handleNewThread = useCallback(() => {
    setGeneralActiveThread(null);
  }, [setGeneralActiveThread]);

  const handleCitationClick = useCallback((citation: CitationPart) => {
    // TODO: Navigate to reader page with this citation
    // For now, log to console. Future enhancement: use router to navigate to /reader/${citation.bookId}?cfi=${citation.cfi}
    console.log("Citation clicked:", citation);
  }, []);

  const displayMessages = convertToMessageV2(activeThread?.messages || []);
  const allMessages = mergeMessagesWithStreaming(displayMessages, currentMessage, isStreaming);

  return (
    <div className="relative flex h-full flex-col">
      <ThreadsSidebar
        open={showThreads}
        onClose={() => setShowThreads(false)}
        onSelect={(id) => setGeneralActiveThread(id)}
      />
      <div className="relative flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThreads(true)}
            className="rounded-full p-1.5 text-neutral-600 hover:bg-muted"
          >
            <History className="size-4" />
          </button>
          {bookTitle && (
            <span className="text-xs text-muted-foreground">
              {t("chat.context")}: <span className="font-medium text-neutral-700">{bookTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ModelSelector />
          <ContextPopover />
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-full p-1.5 text-neutral-600 hover:bg-muted"
          >
            <MessageCirclePlus className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Message list or empty state - consistent container structure */}
        <div className="flex-1 overflow-hidden">
          {allMessages.length > 0 ? (
            <MessageList
              messages={allMessages}
              isStreaming={isStreaming}
              currentStep={currentStep}
              onStop={stopStream}
              onCitationClick={handleCitationClick}
            />
          ) : (
            <EmptyState onSuggestionClick={handleSend} />
          )}
        </div>

        {/* Input always at bottom with consistent position */}
        <div className="shrink-0 px-4 pb-3 pt-2">
          <ChatInput onSend={handleSend} onStop={stopStream} isStreaming={isStreaming} />
        </div>
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
    </div>
  );
}
