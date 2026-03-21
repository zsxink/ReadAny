import type { TTSConfig } from "@readany/core/tts";
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

  play: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
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

export const useTTSStore = create<TTSState>()(
  withPersist("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,

    play: (text: string) => {
      console.log("[TTSStore] play called with text length:", text?.length);
      if (!text || !text.trim()) {
        console.log("[TTSStore] No text to speak");
        return;
      }
      set({ playState: "loading", currentText: text });

      // Detect language from text
      const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
      const language = cjk && cjk.length > text.length * 0.1 ? "zh-CN" : "en-US";
      console.log("[TTSStore] detected language:", language);

      Speech.speak(text, {
        rate: get().config.rate || 1.0,
        pitch: get().config.pitch || 1.0,
        language: language,
        onDone: () => {
          console.log("[TTSStore] Speech.onDone");
          set({ playState: "stopped" });
          get().onEnd?.();
        },
        onStopped: () => {
          console.log("[TTSStore] Speech.onStopped");
          set({ playState: "stopped" });
        },
        onError: (e) => {
          console.log("[TTSStore] Speech.onError:", e);
          set({ playState: "stopped" });
          get().onEnd?.();
        },
        onStart: () => {
          console.log("[TTSStore] Speech.onStart");
          set({ playState: "playing" });
        },
      });
    },

    pause: () => {
      console.log("[TTSStore] pause called");
      Speech.pause();
      set({ playState: "paused" });
    },

    resume: () => {
      console.log("[TTSStore] resume called");
      Speech.resume();
      set({ playState: "playing" });
    },

    stop: () => {
      console.log("[TTSStore] stop called");
      Speech.stop();
      set({ playState: "stopped", currentText: "" });
    },

    toggle: (text?: string) => {
      console.log("[TTSStore] toggle called, playState:", get().playState);
      const { playState, currentText, play } = get();
      if (playState === "playing") {
        Speech.pause();
        set({ playState: "paused" });
      } else if (playState === "paused") {
        Speech.resume();
        set({ playState: "playing" });
      } else if (text) {
        play(text);
      } else if (currentText) {
        play(currentText);
      }
    },

    updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),

    setPlayState: (playState) => set({ playState }),

    setOnEnd: (cb) => set({ onEnd: cb }),
  })),
);

export function setTTSPlayerFactories(): void {
  console.log("TTS using expo-speech");
}
