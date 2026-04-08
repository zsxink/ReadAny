/**
 * TTS Store — Zustand store for TTS state and configuration.
 *
 * Manages:
 * - Playback state (playing/paused/stopped)
 * - TTS configuration (engine, voice, rate, pitch, DashScope key)
 * - Persists config to FS
 *
 * Cross-platform: player factories are injectable. By default uses Web-based
 * BrowserTTSPlayer/EdgeTTSPlayer/DashScopeTTSPlayer. Platforms without Web Audio
 * (e.g. React Native) can override via `setTTSPlayerFactories()`.
 */
import { create } from "zustand";
import { BrowserTTSPlayer, DashScopeTTSPlayer, EdgeTTSPlayer } from "../tts/tts-players";
import type { ITTSPlayer, TTSConfig } from "../tts/types";
import { DEFAULT_TTS_CONFIG } from "../tts/types";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

/**
 * TTS player factory interface — allows platforms to provide custom player implementations.
 */
export interface TTSPlayerFactories {
  createBrowserTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
}

/** Default Web-based factories */
const defaultFactories: TTSPlayerFactories = {
  createBrowserTTS: () => new BrowserTTSPlayer(),
  createEdgeTTS: () => new EdgeTTSPlayer(),
  createDashScopeTTS: () => new DashScopeTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;

/**
 * Override TTS player factories for platforms that cannot use Web Audio APIs.
 * Call this at app startup before any TTS playback.
 *
 * Example (React Native):
 *   setTTSPlayerFactories({
 *     createBrowserTTS: () => new ExpoSpeechTTSPlayer(),
 *     createEdgeTTS: () => new ExpoAVEdgeTTSPlayer(),
 *     createDashScopeTTS: () => new ExpoAVDashScopeTTSPlayer(),
 *   });
 */
export function setTTSPlayerFactories(factories: Partial<TTSPlayerFactories>): void {
  _factories = { ...defaultFactories, ...factories };
  // Reset cached instances so new factories take effect
  _browserTTS = null;
  _edgeTTS = null;
  _dashscopeTTS = null;
}

/** Lazily-created singleton TTS player instances */
let _browserTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;

function getBrowserTTS(): ITTSPlayer {
  if (!_browserTTS) _browserTTS = _factories.createBrowserTTS();
  return _browserTTS;
}

function getEdgeTTS(): ITTSPlayer {
  if (!_edgeTTS) _edgeTTS = _factories.createEdgeTTS();
  return _edgeTTS;
}

function getDashScopeTTS(): ITTSPlayer {
  if (!_dashscopeTTS) _dashscopeTTS = _factories.createDashScopeTTS();
  return _dashscopeTTS;
}

export interface TTSState {
  /** Current playback state */
  playState: TTSPlayState;
  /** Current text being spoken */
  currentText: string;
  /** TTS configuration (persisted) */
  config: TTSConfig;
  /** Callback invoked when current text finishes playing naturally (not by stop) */
  onEnd: (() => void) | null;
  /** Index of the currently-speaking chunk (0-based) */
  currentChunkIndex: number;
  /** Total number of chunks for the current text */
  totalChunks: number;
  /** Title of the book currently being read (for floating bubble display) */
  currentBookTitle: string;
  /** Chapter title currently being read (for floating bubble display) */
  currentChapterTitle: string;
  /** Book ID currently being read (for navigation back to reader) */
  currentBookId: string;

  // Actions
  play: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
  setCurrentBook: (title: string, chapter: string, bookId?: string) => void;
  setChunkProgress: (index: number, total: number) => void;
}

export const useTTSStore = create<TTSState>()(
  withPersist("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,
    currentChunkIndex: 0,
    totalChunks: 0,
    currentBookTitle: "",
    currentChapterTitle: "",
    currentBookId: "",

    play: (text: string) => {
      const { config } = get();
      set({ playState: "loading", currentText: text, currentChunkIndex: 0, totalChunks: 0 });

      const onState = (state: "playing" | "paused" | "stopped") => {
        set({ playState: state });
      };

      const onChunk = (index: number, total: number) => {
        set({ currentChunkIndex: index, totalChunks: total });
      };

      const handleEnd = () => {
        const currentOnEnd = get().onEnd;
        currentOnEnd?.();
      };

      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        const player = getDashScopeTTS();
        player.onStateChange = onState;
        player.onChunkChange = onChunk;
        player.onEnd = handleEnd;
        player.speak(text, config);
      } else if (config.engine === "edge") {
        const player = getEdgeTTS();
        player.onStateChange = onState;
        player.onChunkChange = onChunk;
        player.onEnd = handleEnd;
        player.speak(text, config);
      } else {
        const player = getBrowserTTS();
        player.onStateChange = onState;
        player.onChunkChange = onChunk;
        player.onEnd = handleEnd;
        player.speak(text, config);
      }
    },

    pause: () => {
      const { config } = get();
      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        getDashScopeTTS().pause();
      } else if (config.engine === "edge") {
        getEdgeTTS().pause();
      } else {
        getBrowserTTS().pause();
      }
    },

    resume: () => {
      const { config } = get();
      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        getDashScopeTTS().resume();
      } else if (config.engine === "edge") {
        getEdgeTTS().resume();
      } else {
        getBrowserTTS().resume();
      }
    },

    stop: () => {
      const browser = getBrowserTTS();
      const edge = getEdgeTTS();
      const dashscope = getDashScopeTTS();
      browser.onEnd = undefined;
      edge.onEnd = undefined;
      dashscope.onEnd = undefined;
      browser.stop();
      edge.stop();
      dashscope.stop();
      set({ playState: "stopped", currentText: "", currentChunkIndex: 0, totalChunks: 0 });
    },

    toggle: (text?: string) => {
      const { playState, currentText, play, pause, resume } = get();
      if (playState === "playing") {
        pause();
      } else if (playState === "paused") {
        resume();
      } else if (text) {
        play(text);
      } else if (currentText) {
        play(currentText);
      }
    },

    updateConfig: (updates) =>
      set((s) => ({
        config: { ...s.config, ...updates },
      })),

    setPlayState: (playState) => set({ playState }),

    setOnEnd: (cb) => set({ onEnd: cb }),

    setCurrentBook: (title, chapter, bookId) =>
      set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

    setChunkProgress: (index, total) => set({ currentChunkIndex: index, totalChunks: total }),
  })),
);
