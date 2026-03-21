import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import i18n from "@readany/core/i18n";
import type { AttachedQuote, Book, SemanticContext } from "@readany/core/types";
import type { Thread } from "@readany/core/types";
import type {
  MessageV2,
  Part,
  ReasoningPart,
  TextPart,
  ToolCallPart,
} from "@readany/core/types/message";
import {
  createAbortedPart,
  createReasoningPart,
  createTextPart,
} from "@readany/core/types/message";
import { useCallback, useRef, useState } from "react";

export interface StreamingChatOptions {
  book?: Book | null;
  semanticContext?: SemanticContext | null;
  bookId?: string;
}

export interface StreamingState {
  isStreaming: boolean;
  currentMessage: MessageV2 | null;
  currentStep: "thinking" | "tool_calling" | "responding" | "idle";
}

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useStreamingChat(_options?: StreamingChatOptions) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    currentMessage: null,
    currentStep: "idle",
  });
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingStateRef = useRef<{
    messageId: string;
    thread: Thread | null;
    fullText: string;
    currentParts: Part[];
    currentTextPart: TextPart | null;
    currentReasoningPart: ReasoningPart | null;
  }>({
    messageId: "",
    thread: null,
    fullText: "",
    currentParts: [],
    currentTextPart: null,
    currentReasoningPart: null,
  });

  const { createThread, addMessage, updateThreadTitle, setStreaming } = useChatStore();

  const getOrCreateThread = useCallback(
    async (bookId?: string): Promise<Thread> => {
      const {
        threads: freshThreads,
        generalActiveThreadId,
        bookActiveThreadIds,
      } = useChatStore.getState();
      const activeId = bookId ? bookActiveThreadIds[bookId] || null : generalActiveThreadId;
      const existing = activeId ? freshThreads.find((t) => t.id === activeId) : null;
      if (existing) return existing;
      return await createThread(bookId);
    },
    [createThread],
  );

  const saveAbortedMessage = useCallback(async () => {
    const { messageId, thread, currentParts } = streamingStateRef.current;

    if (!thread) {
      setState({
        isStreaming: false,
        currentMessage: null,
        currentStep: "idle",
      });
      setStreaming(false);
      return;
    }

    for (const part of currentParts) {
      if (part.status === "running") {
        if (part.type === "tool_call") {
          part.status = "error";
          (part as ToolCallPart).error = i18n.t("streaming.aborted");
        } else {
          part.status = "completed";
        }
        part.updatedAt = Date.now();
      }
    }

    const abortedPart = createAbortedPart(i18n.t("streaming.aborted"));
    currentParts.push(abortedPart);

    const textContent = currentParts
      .filter((p) => p.type === "text")
      .map((p) => (p as TextPart).text)
      .join("\n");

    const abortedMessage = {
      id: messageId,
      threadId: thread.id,
      role: "assistant" as const,
      content: textContent,
      parts: currentParts,
      createdAt: Date.now(),
    };

    setState((prev) => ({ ...prev, currentStep: "idle" }));
    await addMessage(thread.id, abortedMessage as any);

    setState({
      isStreaming: false,
      currentMessage: null,
      currentStep: "idle",
    });
    setStreaming(false);
  }, [addMessage, setStreaming]);

  const sendMessage = useCallback(
    async (
      content: string,
      overrideBookId?: string,
      _deepThinking?: boolean,
      _spoilerFree?: boolean,
      quotes?: AttachedQuote[],
    ) => {
      if ((!content.trim() && (!quotes || quotes.length === 0)) || state.isStreaming) return;

      const messageId = createMessageId();
      const initialMessage: MessageV2 = {
        id: messageId,
        threadId: "",
        role: "assistant",
        parts: [],
        createdAt: Date.now(),
      };

      setError(null);

      streamingStateRef.current = {
        messageId,
        thread: null,
        fullText: "",
        currentParts: [],
        currentTextPart: null,
        currentReasoningPart: null,
      };

      try {
        const bookId = overrideBookId ?? _options?.bookId;
        const thread = await getOrCreateThread(bookId);
        streamingStateRef.current.thread = thread;

        if (thread.messages.length === 0 && !thread.title) {
          await updateThreadTitle(thread.id, content.slice(0, 50));
        }

        let aiPrompt = content.trim();
        if (quotes && quotes.length > 0) {
          const quotesText = quotes.map((q) => `> ${q.text.slice(0, 300)}`).join("\n\n");
          aiPrompt = content.trim()
            ? i18n.t("chat.aboutFollowingText", "关于以下文本：") +
              `\n${quotesText}\n\n${content.trim()}`
            : i18n.t("chat.aboutFollowingTextAnalyze", "关于以下文本：") +
              `\n${quotesText}\n\n` +
              i18n.t("chat.helpAnalyzeText", "请帮我分析这段文本。");
        }

        const userMessageId = createMessageId();
        const userParts: Part[] = [];
        if (quotes && quotes.length > 0) {
          for (const q of quotes) {
            userParts.push({
              id: `quote-${Date.now()}-${Math.random()}`,
              type: "quote" as const,
              text: q.text,
              source: q.source,
              status: "completed" as const,
              createdAt: Date.now(),
            });
          }
        }
        if (content.trim()) {
          userParts.push(createTextPart(content.trim()));
        }

        const userMessage = {
          id: userMessageId,
          threadId: thread.id,
          role: "user" as const,
          content: aiPrompt,
          parts: userParts,
          createdAt: Date.now(),
        };

        await addMessage(thread.id, userMessage as any);

        setState({
          isStreaming: true,
          currentMessage: initialMessage,
          currentStep: "thinking",
        });
        setStreaming(true);

        const { getActiveEndpoint, aiConfig } = useSettingsStore.getState();
        const endpoint = await getActiveEndpoint();
        const model = aiConfig.activeModel;

        if (!endpoint?.apiKey || !model) {
          throw new Error(
            i18n.t("settings.configureAIModelError", "请先在设置中配置 AI 端点和模型"),
          );
        }

        const history = thread.messages.slice(-8).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        const systemPrompt = `You are ReadAny AI, an intelligent reading assistant. You help users understand, analyze, and engage with the books they are reading. Provide thoughtful insights and answer questions about the content. Respond in the same language as the user's question.`;

        abortControllerRef.current = new AbortController();

        const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${endpoint.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user", content: aiPrompt },
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: 4096,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error(i18n.t("chat.cannotReadStream", "无法读取响应流"));
        }

        const decoder = new TextDecoder();

        setState((prev) => ({ ...prev, currentStep: "responding" }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                // Handle reasoning_content (DeepSeek)
                const reasoningContent = delta?.reasoning_content;
                if (reasoningContent) {
                  if (!streamingStateRef.current.currentReasoningPart) {
                    streamingStateRef.current.currentReasoningPart = createReasoningPart("");
                    streamingStateRef.current.currentParts.push(
                      streamingStateRef.current.currentReasoningPart,
                    );
                  }
                  streamingStateRef.current.currentReasoningPart.text += reasoningContent;
                  streamingStateRef.current.currentReasoningPart.status = "running";
                  streamingStateRef.current.currentReasoningPart.updatedAt = Date.now();

                  setState((prev) => ({
                    ...prev,
                    currentMessage: prev.currentMessage
                      ? {
                          ...prev.currentMessage,
                          parts: [...streamingStateRef.current.currentParts],
                        }
                      : null,
                  }));
                }

                // Handle regular content
                const token = delta?.content;
                if (token) {
                  streamingStateRef.current.fullText += token;
                  if (!streamingStateRef.current.currentTextPart) {
                    streamingStateRef.current.currentTextPart = createTextPart("");
                    streamingStateRef.current.currentParts.push(
                      streamingStateRef.current.currentTextPart,
                    );
                  }
                  streamingStateRef.current.currentTextPart.text =
                    streamingStateRef.current.fullText;
                  streamingStateRef.current.currentTextPart.status = "running";
                  streamingStateRef.current.currentTextPart.updatedAt = Date.now();

                  setState((prev) => ({
                    ...prev,
                    currentMessage: prev.currentMessage
                      ? {
                          ...prev.currentMessage,
                          parts: [...streamingStateRef.current.currentParts],
                        }
                      : null,
                  }));
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

        if (streamingStateRef.current.currentReasoningPart) {
          streamingStateRef.current.currentReasoningPart.status = "completed";
          streamingStateRef.current.currentReasoningPart.updatedAt = Date.now();
        }

        if (streamingStateRef.current.currentTextPart) {
          streamingStateRef.current.currentTextPart.status = "completed";
          streamingStateRef.current.currentTextPart.updatedAt = Date.now();
        }

        const reasoning = streamingStateRef.current.currentParts
          .filter((p) => p.type === "reasoning")
          .map((p) => ({
            id: p.id,
            type: (p as ReasoningPart).thinkingType || "thinking",
            content: (p as ReasoningPart).text,
            timestamp: p.createdAt,
          }));

        const partsOrder = streamingStateRef.current.currentParts.map((p) => {
          const base = {
            type: p.type as "text" | "reasoning" | "tool_call" | "citation" | "mindmap",
            id: p.id,
          };
          if (p.type === "text") {
            return { ...base, text: (p as TextPart).text };
          }
          return base;
        });

        const assistantMessage = {
          id: messageId,
          threadId: thread.id,
          role: "assistant" as const,
          content: streamingStateRef.current.fullText,
          parts: streamingStateRef.current.currentParts,
          reasoning: reasoning.length > 0 ? reasoning : undefined,
          partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
          createdAt: Date.now(),
        };

        setState((prev) => ({ ...prev, currentStep: "idle" }));
        await addMessage(thread.id, assistantMessage as any);

        setState({
          isStreaming: false,
          currentMessage: null,
          currentStep: "idle",
        });
        setStreaming(false);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          await saveAbortedMessage();
          return;
        }

        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);

        const errorPart = createTextPart(`⚠️ ${error.message}`);
        errorPart.status = "error";

        const errorMessage = {
          id: messageId,
          threadId: streamingStateRef.current.thread?.id || "",
          role: "assistant" as const,
          content: error.message,
          parts: [errorPart],
          createdAt: Date.now(),
        };

        setState((prev) => ({ ...prev, currentStep: "idle" }));
        if (streamingStateRef.current.thread) {
          await addMessage(streamingStateRef.current.thread.id, errorMessage as any);
        }

        setState({
          isStreaming: false,
          currentMessage: null,
          currentStep: "idle",
        });
        setStreaming(false);
      }
    },
    [
      state.isStreaming,
      getOrCreateThread,
      addMessage,
      updateThreadTitle,
      setStreaming,
      _options?.bookId,
      saveAbortedMessage,
    ],
  );

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    ...state,
    error,
    sendMessage,
    stopStream,
  };
}
