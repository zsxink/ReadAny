/**
 * Constants and utility types shared by ReaderScreen and its sub-modules.
 */
import { Dimensions, NativeEventEmitter, NativeModules } from "react-native";

export const SCREEN_WIDTH = Dimensions.get("window").width;
export const SCREEN_HEIGHT = Dimensions.get("window").height;
export const CONTROLS_TIMEOUT = 4000;

export const FONT_THEMES = [
  { id: "default", labelKey: "reader.fontThemeDefault", fallback: "System" },
  { id: "classic", labelKey: "reader.fontThemeClassic", fallback: "Classic" },
  { id: "modern", labelKey: "reader.fontThemeModern", fallback: "Modern" },
  { id: "elegant", labelKey: "reader.fontThemeElegant", fallback: "Elegant" },
  { id: "literary", labelKey: "reader.fontThemeLiterary", fallback: "Literary" },
];

// ─── Volume Manager ───

export type VolumeManagerNativeModule = {
  showNativeVolumeUI?: (config: { enabled: boolean }) => Promise<void>;
  getVolume?: () => Promise<{ volume?: number }>;
  setVolume?: (
    value: number,
    config?: { showUI?: boolean; playSound?: boolean; type?: string },
  ) => Promise<void>;
};

export type VolumeManagerLike = {
  showNativeVolumeUI: (config: { enabled: boolean }) => Promise<void>;
  getVolume: () => Promise<{ volume?: number }>;
  setVolume: (
    value: number,
    config?: { showUI?: boolean; playSound?: boolean; type?: string },
  ) => Promise<void>;
  addVolumeListener: (callback: (result: { volume?: number }) => void) => { remove: () => void };
};

let cachedVolumeManager: VolumeManagerLike | null | undefined;

export function getVolumeManager(): VolumeManagerLike | null {
  if (cachedVolumeManager !== undefined) {
    return cachedVolumeManager;
  }

  const nativeModule = NativeModules.VolumeManager as VolumeManagerNativeModule | undefined;
  if (
    !nativeModule ||
    typeof nativeModule.getVolume !== "function" ||
    typeof nativeModule.setVolume !== "function" ||
    typeof nativeModule.showNativeVolumeUI !== "function"
  ) {
    cachedVolumeManager = null;
    return cachedVolumeManager;
  }

  const eventEmitter = new NativeEventEmitter(NativeModules.VolumeManager);
  cachedVolumeManager = {
    showNativeVolumeUI: (config) => nativeModule.showNativeVolumeUI!(config),
    getVolume: () => nativeModule.getVolume!(),
    setVolume: (value, config) => nativeModule.setVolume!(value, config),
    addVolumeListener: (callback) => {
      const subscription = eventEmitter.addListener("RNVMEventVolume", callback);
      return {
        remove: () => subscription.remove(),
      };
    },
  };
  return cachedVolumeManager;
}

export function formatReaderClock(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
