import { useLibraryStore } from "@/stores/library-store";
import { useSyncStore } from "@/stores/sync-store";
/**
 * Hook for managing auto-sync lifecycle.
 * Uses the shared core sync store instead of Rust backend events.
 */
import { useEffect, useRef } from "react";

function hasAutoSync(config: unknown): config is { autoSync: boolean; syncIntervalMins?: number } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

/** Auto-sync: load config, trigger on startup (delayed), and periodically */
export function useAutoSync() {
  const config = useSyncStore((s) => s.config);
  const isConfigured = useSyncStore((s) => s.isConfigured);
  const syncNow = useSyncStore((s) => s.syncNow);
  const loadConfig = useSyncStore((s) => s.loadConfig);
  const status = useSyncStore((s) => s.status);
  const lastResult = useSyncStore((s) => s.lastResult);
  const loadBooks = useLibraryStore((s) => s.loadBooks);
  const statusRef = useRef(status);
  statusRef.current = status;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Refresh library after a successful download sync
  useEffect(() => {
    if (
      lastResult?.success &&
      (lastResult.direction === "download" || lastResult.filesDownloaded > 0)
    ) {
      loadBooks();
    }
  }, [lastResult, loadBooks]);

  // Delayed startup sync + periodic sync
  useEffect(() => {
    const autoSyncEnabled = hasAutoSync(config) && config.autoSync;

    if (!isConfigured || !autoSyncEnabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Delayed startup sync (10 seconds after mount)
    const startupTimer = setTimeout(() => {
      if (statusRef.current === "idle") {
        syncNow();
      }
    }, 10_000);

    // Periodic sync
    const intervalMs = (hasAutoSync(config) ? config.syncIntervalMins || 30 : 30) * 60 * 1000;
    timerRef.current = setInterval(() => {
      if (statusRef.current === "idle") {
        syncNow();
      }
    }, intervalMs);

    return () => {
      clearTimeout(startupTimer);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isConfigured, config, syncNow]);
}
