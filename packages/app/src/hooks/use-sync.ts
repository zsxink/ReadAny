/**
 * Hook for listening to sync events from the Rust backend
 * and managing auto-sync lifecycle
 */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSyncStore, type SyncResult } from "@/stores/sync-store";
import { useLibraryStore } from "@/stores/library-store";

/** Listen for sync:complete events and refresh status */
export function useSyncEvents() {
  const loadStatus = useSyncStore((s) => s.loadStatus);
  const loadBooks = useLibraryStore((s) => s.loadBooks);

  useEffect(() => {
    const unlisten = listen<SyncResult>("sync:complete", (event) => {
      loadStatus();
      // Refresh books if any records were downloaded
      if (event.payload.records_downloaded > 0 || event.payload.files_downloaded > 0) {
        loadBooks();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadStatus, loadBooks]);
}

/** Auto-sync: trigger on startup (delayed) and periodically */
export function useAutoSync() {
  const config = useSyncStore((s) => s.config);
  const syncNow = useSyncStore((s) => s.syncNow);
  const loadConfig = useSyncStore((s) => s.loadConfig);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Delayed startup sync + periodic sync
  useEffect(() => {
    if (!config?.auto_sync) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Delayed startup sync (10 seconds after mount)
    const startupTimer = setTimeout(() => {
      if (!isSyncing) {
        syncNow();
      }
    }, 10_000);

    // Periodic sync
    const intervalMs = (config.sync_interval_mins || 30) * 60 * 1000;
    timerRef.current = setInterval(() => {
      if (!isSyncing) {
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
  }, [config?.auto_sync, config?.sync_interval_mins, syncNow, isSyncing]);
}
