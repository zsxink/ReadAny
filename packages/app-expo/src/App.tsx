/**
 * ReadAny Expo App — Root component
 *
 * Initialises platform service, i18n, and mounts navigation.
 */

// Polyfill AbortSignal.throwIfAborted — missing in Hermes, required by LangChain
if (typeof AbortSignal !== "undefined" && !AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) {
      const err = this.reason ?? new Error("The operation was aborted.");
      throw err;
    }
  };
}

import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { rnSessionEventSource } from "@/hooks";
import { setStreamingFetch } from "@readany/core/ai/llm-provider";
import { initDatabase } from "@readany/core/db/database";
import { setSessionEventSource } from "@readany/core/hooks/use-reading-session";
import { i18nReady, initI18nLanguage } from "@readany/core/i18n";
import i18n from "@readany/core/i18n";
import { setPlatformService } from "@readany/core/services";
import { setSyncAdapter } from "@readany/core/sync";
import { I18nextProvider } from "react-i18next";

import { ExpoPlatformService } from "@/lib/platform/expo-platform-service";
import { MobileSyncAdapter } from "@/lib/sync/sync-adapter-mobile";
import { RNEmbeddingEngine } from "@/lib/ai/rn-embedding-engine";
import { RootNavigator } from "@/navigation/RootNavigator";
import { ThemeProvider, useTheme } from "@/styles/ThemeContext";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      // 1. Register platform service
      const platform = new ExpoPlatformService();
      setPlatformService(platform);

      // 2. Register sync adapter
      setSyncAdapter(new MobileSyncAdapter());

      // 3. Initialize database (create tables)
      await initDatabase();

      // 4. Wait for i18n to be ready
      try {
        await i18nReady;
        console.log("[App] i18n initialized successfully");
      } catch (error) {
        console.error("[App] i18n initialization failed:", error);
        // Continue anyway, i18n will use default language
      }

      // 5. Register RN-specific adapters
      setSessionEventSource(rnSessionEventSource);

      // 6. Restore persisted language
      await initI18nLanguage();

      // 7. Inject streaming-compatible fetch for AI calls
      const { fetch: expoFetch } = await import("expo/fetch");
      setStreamingFetch(expoFetch as typeof globalThis.fetch);

      // 8. Inject React Native local embedding engine
      const { setLocalEmbeddingEngine } = await import("@readany/core/ai/local-embedding-service");
      setLocalEmbeddingEngine(new RNEmbeddingEngine());

      setReady(true);
    }
    bootstrap();
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#1c1c1e",
        }}
      >
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </I18nextProvider>
  );
}

function AppInner() {
  const { colors, isDark, mode } = useTheme();

  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, isDark],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
