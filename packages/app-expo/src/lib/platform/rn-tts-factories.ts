/**
 * React Native TTS player factories.
 *
 * - SystemTTS  → expo-speech (native OS TTS, background NOT supported)
 * - EdgeTTS    → react-native-track-player + Edge TTS WebSocket API (background + notification controls)
 * - DashScope  → react-native-track-player + DashScope MP3 API (background + notification controls)
 */
import type { TTSPlayerFactories } from "@readany/core/stores";
import { ExpoSpeechTTSPlayer } from "./expo-speech-player";
import { TrackPlayerDashScopeTTSPlayer } from "./track-player-dashscope-player";
import { TrackPlayerEdgeTTSPlayer } from "./track-player-edge-player";

export const rnTTSPlayerFactories: TTSPlayerFactories = {
  createSystemTTS: () => new ExpoSpeechTTSPlayer(),
  createEdgeTTS: () => new TrackPlayerEdgeTTSPlayer(),
  createDashScopeTTS: () => new TrackPlayerDashScopeTTSPlayer(),
};
