import { splitNarrationText, type TTSConfig } from "@readany/core/tts";
import * as Speech from "expo-speech";
/**
 * TTS Store for React Native
 * Uses expo-speech for text-to-speech
 */
import { create } from "zustand";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSState {
  playState: TTSPlayState;
  currentText: string;
  config: TTSConfig;
  onEnd: (() => void) | null;
  currentBookTitle: string;
  currentChapterTitle: string;
  currentBookId: string;
  currentLocationCfi: string;
  currentChunkIndex: number;
  totalChunks: number;

  play: (text: string | string[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
  setCurrentBook: (title: string, chapter: string, bookId?: string) => void;
  setCurrentLocation: (cfi?: string | null) => void;
  setChunkProgress: (index: number, total: number) => void;
  /** Jump to a specific chunk index within the current session, restarting speech from that point */
  jumpToChunk: (index: number) => void;
}

const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: "browser",
  voiceName: "",
  rate: 1.0,
  pitch: 1.0,
  edgeVoice: "zh-CN-XiaoxiaoNeural",
  dashscopeApiKey: "",
  dashscopeVoice: "Cherry",
};

let _sessionSegments: string[] = [];
let _sessionIndex = 0;
let _sessionStopped = false;
let _sessionLanguage = "zh-CN";
/** Generation counter — incremented on every play/jumpToChunk to invalidate stale callbacks */
let _sessionGeneration = 0;

function normalizeSegments(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text.map((segment) => segment.trim()).filter(Boolean);
  }
  return splitNarrationText(text).map((segment) => segment.trim()).filter(Boolean);
}

function stopSpeechSilently() {
  try {
    Speech.stop();
  } catch {}
}

function detectLanguage(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  return cjk && cjk.length > text.length * 0.1 ? "zh-CN" : "en-US";
}

function speakSegmentQueue(
  set: (partial: Partial<TTSState>) => void,
  get: () => TTSState,
  language: string,
  options?: { showLoading?: boolean },
) {
  const gen = _sessionGeneration;
  if (_sessionStopped || _sessionIndex >= _sessionSegments.length) {
    console.log("[TTSStore] Session finished");
    set({ playState: "stopped" });
    get().onEnd?.();
    return;
  }

  const segment = _sessionSegments[_sessionIndex];
  if (options?.showLoading) {
    set({
      playState: "loading",
      currentChunkIndex: _sessionIndex,
      totalChunks: _sessionSegments.length,
    });
  } else {
    set({
      currentChunkIndex: _sessionIndex,
      totalChunks: _sessionSegments.length,
    });
  }

  Speech.speak(segment, {
    rate: get().config.rate || 1.0,
    pitch: get().config.pitch || 1.0,
    language,
    onDone: () => {
      if (_sessionStopped || gen !== _sessionGeneration) return;
      _sessionIndex += 1;
      speakSegmentQueue(set, get, language);
    },
    onStopped: () => {
      console.log("[TTSStore] Speech.onStopped");
    },
    onError: (e) => {
      console.log("[TTSStore] Speech.onError:", e);
      if (_sessionStopped || gen !== _sessionGeneration) return;
      _sessionIndex += 1;
      speakSegmentQueue(set, get, language);
    },
    onStart: () => {
      if (gen !== _sessionGeneration) return;
      console.log("[TTSStore] Speech.onStart");
      set({
        playState: "playing",
        currentChunkIndex: _sessionIndex,
        totalChunks: _sessionSegments.length,
      });
    },
  });
}

export const useTTSStore = create<TTSState>()(
  withPersist<TTSState>("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,
    currentBookTitle: "",
    currentChapterTitle: "",
    currentBookId: "",
    currentLocationCfi: "",
    currentChunkIndex: 0,
    totalChunks: 0,

    play: (text: string | string[]) => {
      const segments = normalizeSegments(text);
      const joinedText = segments.join(" ").trim();
      console.log("[TTSStore] play called with segments:", segments.length);
      if (!joinedText) {
        console.log("[TTSStore] No text to speak");
        return;
      }
      stopSpeechSilently();
      _sessionGeneration += 1;
      _sessionSegments = segments;
      _sessionIndex = 0;
      _sessionStopped = false;
      _sessionLanguage = detectLanguage(joinedText);
      set({
        playState: "loading",
        currentText: joinedText,
        currentChunkIndex: 0,
        totalChunks: segments.length,
      });
      console.log("[TTSStore] detected language:", _sessionLanguage);
      speakSegmentQueue(set, get, _sessionLanguage, { showLoading: true });
    },

    pause: () => {
      console.log("[TTSStore] pause called");
      const state = get().playState;
      if (state !== "playing" && state !== "loading") return;
      _sessionGeneration += 1;
      _sessionStopped = true;
      stopSpeechSilently();
      set({ playState: "paused" });
    },

    resume: () => {
      console.log("[TTSStore] resume called");
      if (_sessionSegments.length === 0 || _sessionIndex >= _sessionSegments.length) {
        set({ playState: "stopped" });
        return;
      }
      _sessionGeneration += 1;
      _sessionStopped = false;
      set({
        playState: "loading",
        currentChunkIndex: _sessionIndex,
        totalChunks: _sessionSegments.length,
      });
      speakSegmentQueue(set, get, _sessionLanguage, { showLoading: false });
    },

    stop: () => {
      console.log("[TTSStore] stop called");
      _sessionGeneration += 1;
      _sessionStopped = true;
      _sessionSegments = [];
      _sessionIndex = 0;
      stopSpeechSilently();
      set({
        playState: "stopped",
        currentText: "",
        currentChunkIndex: 0,
        totalChunks: 0,
        currentLocationCfi: "",
      });
    },

    toggle: (text?: string) => {
      console.log("[TTSStore] toggle called, playState:", get().playState);
      const { playState, currentText, play } = get();
      if (playState === "playing") {
        get().pause();
      } else if (playState === "paused") {
        get().resume();
      } else if (text) {
        play(text);
      } else if (currentText) {
        play(currentText);
      }
    },

    updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),

    setPlayState: (playState) => set({ playState }),

    setOnEnd: (cb) => set({ onEnd: cb }),

    setCurrentBook: (title, chapter, bookId) =>
      set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

    setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

    setChunkProgress: (index, total) => set({ currentChunkIndex: index, totalChunks: total }),

    jumpToChunk: (index: number) => {
      if (index < 0 || index >= _sessionSegments.length) return;
      stopSpeechSilently();
      _sessionGeneration += 1;
      _sessionIndex = index;
      _sessionStopped = false;
      set({
        playState: "loading",
        currentChunkIndex: index,
        totalChunks: _sessionSegments.length,
      });
      speakSegmentQueue(set, get, _sessionLanguage, { showLoading: false });
    },
  }), {
    playState: "stopped" as const,
    currentText: "",
    currentChunkIndex: 0,
    totalChunks: 0,
    currentLocationCfi: "",
  } as Partial<TTSState>),
);

export function setTTSPlayerFactories(): void {
  console.log("TTS using expo-speech");
}
