import type { AttachedQuote, Book, SemanticContext } from "@readany/core/types";
import type { MessageV2 } from "@readany/core/types/message";
/**
 * React Native stub for useStreamingChat.
 *
 * The real implementation (in @readany/core) imports LangChain which depends
 * on Node.js built-ins unavailable in Hermes.  This stub provides the same
 * public interface so every screen compiles, but streaming is a no-op until
 * a RN-compatible AI backend is wired up.
 */
import { useCallback, useState } from "react";

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

export function useStreamingChat(_options?: StreamingChatOptions) {
  const [state] = useState<StreamingState>({
    isStreaming: false,
    currentMessage: null,
    currentStep: "idle",
  });
  const [error] = useState<Error | null>(null);

  const sendMessage = useCallback(
    async (
      _content: string,
      _overrideBookId?: string,
      _deepThinking?: boolean,
      _quotes?: AttachedQuote[],
    ) => {
      console.warn("[useStreamingChat.rn] AI streaming is not yet available on React Native.");
    },
    [],
  );

  const stopStream = useCallback(() => {
    // no-op
  }, []);

  return {
    ...state,
    error,
    sendMessage,
    stopStream,
  };
}
