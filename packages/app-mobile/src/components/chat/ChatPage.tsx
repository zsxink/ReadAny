/**
 * ChatPage — mobile standalone full-page chat with thread management.
 * Uses core's useStreamingChat hook for AI streaming.
 */
import { useStreamingChat } from "@readany/core/hooks";
import { convertToMessageV2, mergeMessagesWithStreaming } from "@readany/core/utils/chat-utils";
import { useChatReaderStore, useChatStore, useSettingsStore } from "@readany/core/stores";
import type { CitationPart } from "@readany/core/types";
import {
  BookOpen,
  Brain,
  History,
  Library,
  Lightbulb,
  MessageCirclePlus,
  ScrollText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";
import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import { MobileChatInput } from "./MobileChatInput";
import { MessageList } from "./MessageList";
import { MobileModelSelector } from "./MobileModelSelector";
import { MobileContextPopover } from "./MobileContextPopover";

function formatRelativeTime(ts: number, t: (key: string) => string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("chat.justNow");
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

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
      {/* Backdrop */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          open ? "bg-black/20 opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      {/* Sidebar panel */}
      <div
        className={`absolute left-0 top-0 h-full w-[75vw] max-w-[300px] transform rounded-r-2xl border-r bg-background px-3 py-3 shadow-lg transition-all duration-300 ease-out flex flex-col ${
          open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("chat.history")}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 active:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {generalThreads.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("chat.noConversations")}
            </p>
          )}
          {generalThreads.map((thread) => {
            const lastMsg =
              thread.messages.length > 0
                ? thread.messages[thread.messages.length - 1]
                : null;
            const preview = lastMsg?.content?.slice(0, 60) || "";
            return (
              <div
                key={thread.id}
                onClick={() => {
                  onSelect(thread.id);
                  onClose();
                }}
                className={`group flex items-start gap-2 rounded-lg px-3 py-2.5 transition-colors ${
                  thread.id === activeThreadId
                    ? "bg-primary/10 text-primary"
                    : "text-neutral-700 active:bg-muted"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {thread.title || t("chat.newChat")}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/50">
                      {formatRelativeTime(thread.updatedAt, t)}
                    </span>
                  </div>
                  {preview && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeThread(thread.id);
                  }}
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground active:bg-destructive/10 active:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
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
    <div className="flex h-full w-full select-none flex-col items-center justify-center overflow-y-auto p-6">
      <div className="mx-auto w-full space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <Brain className="size-10 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">{t("chat.howCanIHelp")}</h1>
          <p className="text-sm text-muted-foreground">{t("chat.askAboutBooks")}</p>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("chat.getStarted")}</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {SUGGESTIONS.map(({ key, icon: Icon }) => (
              <div
                key={key}
                onClick={() => onSuggestionClick(t(key))}
                className="flex flex-col items-start gap-2.5 rounded-xl bg-muted/70 p-3.5 transition-colors active:bg-muted"
              >
                <Icon className="size-5 text-muted-foreground" />
                <span className="text-xs text-neutral-700 leading-snug">{t(key)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const keyboardHeight = useKeyboardHeight();
  const {
    threads,
    loadAllThreads,
    initialized,
    createThread,
    setGeneralActiveThread,
    getActiveThreadId,
  } = useChatStore();
  const { bookId: contextBookId, bookTitle } = useChatReaderStore();

  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } =
    useStreamingChat({
      bookId: contextBookId || undefined,
    });

  const [showThreads, setShowThreads] = useState(false);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);

  useEffect(() => {
    if (!initialized) loadAllThreads();
  }, [initialized, loadAllThreads]);

  const activeThreadId = getActiveThreadId();
  const activeThread = threads.find((th) => th.id === activeThreadId);

  const handleSend = useCallback(
    async (content: string, deepThinking: boolean = false) => {
      const { aiConfig } = useSettingsStore.getState();
      const endpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
      if (!endpoint?.apiKey || !aiConfig.activeModel) {
        setConfigGuide("ai");
        return;
      }

      if (!activeThreadId) {
        await createThread(undefined, content.slice(0, 50));
        setTimeout(() => sendMessage(content, contextBookId || undefined, deepThinking), 50);
      } else {
        sendMessage(content, contextBookId || undefined, deepThinking);
      }
    },
    [activeThreadId, createThread, sendMessage, contextBookId],
  );

  const handleNewThread = useCallback(() => {
    setGeneralActiveThread(null);
  }, [setGeneralActiveThread]);

  const handleCitationClick = useCallback((_citation: CitationPart) => {
    // TODO: Navigate to reader page with citation
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

      {/* Header */}
      <div className="relative flex h-11 shrink-0 items-center justify-between border-b border-border/50 px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThreads(true)}
            className="rounded-full p-1.5 text-neutral-600 active:bg-muted"
          >
            <History className="size-4" />
          </button>
          {bookTitle && (
            <span className="text-xs text-muted-foreground">
              {t("chat.context")}:{" "}
              <span className="font-medium text-foreground">{bookTitle}</span>
            </span>
          )}
          {!bookTitle && <MobileContextPopover />}
        </div>
        <div className="flex items-center gap-1">
          <MobileModelSelector />
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-full p-1.5 text-neutral-600 active:bg-muted"
          >
            <MessageCirclePlus className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages or Empty */}
      <div className="flex flex-1 flex-col overflow-hidden">
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

        {/* Input */}
        <div
          className="shrink-0 px-3 pt-1"
          style={{
            paddingBottom: keyboardHeight > 0
              ? `${keyboardHeight + 8}px`
              : "4px",
          }}
        >
          <MobileChatInput onSend={handleSend} disabled={isStreaming} />
        </div>
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
    </div>
  );
}
