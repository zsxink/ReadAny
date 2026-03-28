/**
 * Shared auto-sync hook — load config, trigger on startup (delayed), and periodically.
 * Used by both desktop (Tauri) and mobile (Expo) apps.
 *
 * @param onSyncComplete Optional callback when a download sync completes (e.g., to reload the library)
 */
import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/sync-store";

function hasAutoSync(config: unknown): config is { autoSync: boolean; syncIntervalMins?: number } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

export function useAutoSync(onSyncComplete?: () => void) {
  const config = useSyncStore((s) => s.config);
  const isConfigured = useSyncStore((s) => s.isConfigured);
  const syncNow = useSyncStore((s) => s.syncNow);
  const loadConfig = useSyncStore((s) => s.loadConfig);
  const status = useSyncStore((s) => s.status);
  const lastResult = useSyncStore((s) => s.lastResult);
  const error = useSyncStore((s) => s.error);
  const statusRef = useRef(status);
  statusRef.current = status;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  lastErrorRef.current = error;

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
      onSyncComplete?.();
    }
  }, [lastResult, onSyncComplete]);

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

    // Don't auto-sync if last error was auth-related
    if (lastErrorRef.current?.includes("connect") || lastErrorRef.current?.includes("Unauthorized")) {
      console.log("[AutoSync] Skipping auto-sync due to connection/auth error");
      return;
    }

    // Delayed startup sync (10 seconds after mount)
    const startupTimer = setTimeout(() => {
      if (statusRef.current === "idle" && !lastErrorRef.current) {
        syncNow();
      }
    }, 10_000);

    // Periodic sync
    const intervalMs = (hasAutoSync(config) ? config.syncIntervalMins || 30 : 30) * 60 * 1000;
    timerRef.current = setInterval(() => {
      // Skip if there's an error (auth/connection issues)
      if (statusRef.current === "idle" && !lastErrorRef.current) {
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
