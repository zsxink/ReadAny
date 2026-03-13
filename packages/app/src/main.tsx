/**
 * Entry point — mount React app + beforeunload protection
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { i18nReady } from "@readany/core/i18n";
import { initI18nLanguage } from "@readany/core/i18n";
import "./styles/globals.css";
import { useLibraryStore } from "./stores/library-store";
import { flushAllWrites } from "./stores/persist";
import { setPlatformService } from "@readany/core/services";
import { TauriPlatformService } from "./lib/platform/tauri-platform-service";
import { onLibraryChanged } from "@readany/core/events/library-events";

// Register platform service before any database/core operations
const tauriPlatform = new TauriPlatformService();
tauriPlatform.initSync().catch(console.error);
setPlatformService(tauriPlatform);

// Ensure i18n is fully initialized before rendering
i18nReady.then(() => {
  // Restore saved theme from localStorage
  const savedTheme = localStorage.getItem("readany-theme");
  if (savedTheme && ["light", "dark", "sepia"].includes(savedTheme)) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  } else {
    // Default to sepia theme
    document.documentElement.setAttribute("data-theme", "sepia");
  }

  // Restore saved language from platform KV storage
  initI18nLanguage().catch(console.error);

  // Flush pending state writes before window closes
  window.addEventListener("beforeunload", () => {
    flushAllWrites();
  });

  // Initialize database and load books
  useLibraryStore.getState().loadBooks();

  // Refresh library store when AI tools modify books/tags
  onLibraryChanged(() => useLibraryStore.getState().loadBooks());

  // Fire-and-forget: preload foliate-js core modules so they're cached for later use
  import("foliate-js/view.js").catch(() => {});
  import("foliate-js/paginator.js").catch(() => {});

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
