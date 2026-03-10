/**
 * Hooks for React Native
 */

// Re-export the real useStreamingChat from core
export { useStreamingChat } from "@readany/core/hooks/use-streaming-chat";
export type { StreamingChatOptions, StreamingState } from "@readany/core/hooks/use-streaming-chat";

export interface SessionEventSource {
  emit: (event: string, data: unknown) => void;
}

const sessionEventListeners = new Map<string, Set<(data: unknown) => void>>();

export const rnSessionEventSource: SessionEventSource = {
  emit: (event: string, data: unknown) => {
    const listeners = sessionEventListeners.get(event);
    if (listeners) {
      listeners.forEach((fn) => fn(data));
    }
  },
};

export function setSessionEventSource(source: SessionEventSource): void {
  Object.assign(rnSessionEventSource, source);
}

export { useDebounce } from "./use-debounce";
export { useThrottledValue, useThrottledCallback } from "./use-throttled-value";
