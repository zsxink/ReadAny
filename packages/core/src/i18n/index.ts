import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

// Initialize with default "en". Each platform should call
// `initI18nLanguage()` after setPlatformService() to restore the saved lang.
export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

/**
 * Restore saved language from platform KV storage.
 * Call this once at app startup AFTER `setPlatformService()`.
 */
export async function initI18nLanguage(): Promise<void> {
  try {
    const { getPlatformService } = await import("../services/platform");
    const platform = getPlatformService();
    const savedLang = await platform.kvGetItem("readany-lang");
    if (savedLang && savedLang !== i18n.language) {
      await i18n.changeLanguage(savedLang);
    }
  } catch {
    // Platform not ready or storage error — keep default
  }
}

/**
 * Change language and persist the choice to platform KV storage.
 */
export async function changeAndPersistLanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    const { getPlatformService } = await import("../services/platform");
    const platform = getPlatformService();
    await platform.kvSetItem("readany-lang", lang);
  } catch {
    // Ignore persistence errors
  }
}

export default i18n;
