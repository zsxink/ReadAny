import type { TTSConfig } from "@readany/core/types";
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
  voice: "",
  rate: 1.0,
  pitch: 1.0,
};

export const useTTSStore = create<TTSState>()(
  withPersist("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,

    play: (text: string) => {
      set({ playState: "loading", currentText: text });

      Speech.speak(text, {
        rate: get().config.rate || 1.0,
        pitch: get().config.pitch || 1.0,
        onDone: () => {
          set({ playState: "stopped" });
          get().onEnd?.();
        },
        onStopped: () => {
          set({ playState: "stopped" });
        },
        onError: () => {
          set({ playState: "stopped" });
          get().onEnd?.();
        },
        onStart: () => {
          set({ playState: "playing" });
        },
      });
    },

    pause: () => {
      Speech.pause();
      set({ playState: "paused" });
    },

    resume: () => {
      Speech.resume();
      set({ playState: "playing" });
    },

    stop: () => {
      Speech.stop();
      set({ playState: "stopped", currentText: "" });
    },

    toggle: (text?: string) => {
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

export type { TTSPlayerFactories } from "@readany/core/types";
