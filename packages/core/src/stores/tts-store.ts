/**
 * TTS Store — Zustand store for TTS state and configuration.
 *
 * Manages:
 * - Playback state (playing/paused/stopped)
 * - TTS configuration (engine, voice, rate, pitch, DashScope key)
 * - Persists config to FS
 */
import { create } from "zustand";
import type { TTSConfig, ITTSPlayer } from "../tts/types";
import { DEFAULT_TTS_CONFIG } from "../tts/types";
import { BrowserTTSPlayer, EdgeTTSPlayer, DashScopeTTSPlayer } from "../tts/tts-players";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

/** Lazily-created singleton TTS player instances */
let _browserTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;

function getBrowserTTS(): ITTSPlayer {
  if (!_browserTTS) _browserTTS = new BrowserTTSPlayer();
  return _browserTTS;
}

function getEdgeTTS(): ITTSPlayer {
  if (!_edgeTTS) _edgeTTS = new EdgeTTSPlayer();
  return _edgeTTS;
}

function getDashScopeTTS(): ITTSPlayer {
  if (!_dashscopeTTS) _dashscopeTTS = new DashScopeTTSPlayer();
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

  // Actions
  play: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
}

export const useTTSStore = create<TTSState>()(
  withPersist("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,

    play: (text: string) => {
      const { config } = get();
      set({ playState: "loading", currentText: text });

      const onState = (state: "playing" | "paused" | "stopped") => {
        set({ playState: state });
      };

      const handleEnd = () => {
        const currentOnEnd = get().onEnd;
        currentOnEnd?.();
      };

      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        const player = getDashScopeTTS();
        player.onStateChange = onState;
        player.onEnd = handleEnd;
        player.speak(text, config);
      } else if (config.engine === "edge") {
        const player = getEdgeTTS();
        player.onStateChange = onState;
        player.onEnd = handleEnd;
        player.speak(text, config);
      } else {
        const player = getBrowserTTS();
        player.onStateChange = onState;
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
      set({ playState: "stopped", currentText: "" });
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
  })),
);
