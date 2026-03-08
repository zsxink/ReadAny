/**
 * Sync store — WebDAV sync state management
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SyncConfig {
  url: string;
  username: string;
  password: string;
  auto_sync: boolean;
  sync_interval_mins: number;
}

export interface SyncResult {
  success: boolean;
  records_uploaded: number;
  records_downloaded: number;
  records_merged: number;
  files_uploaded: number;
  files_downloaded: number;
  conflicts_count: number;
  duration_ms: number;
  error: string | null;
}

export interface SyncStatus {
  is_configured: boolean;
  is_syncing: boolean;
  last_sync_at: number | null;
  last_result: SyncResult | null;
  device_id: string | null;
  phase: string | null;
  progress: number | null;
}

interface SyncState {
  config: SyncConfig | null;
  status: SyncStatus;
  isSyncing: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadConfig: () => Promise<void>;
  loadStatus: () => Promise<void>;
  testConnection: (url: string, username: string, password: string) => Promise<boolean>;
  saveConfig: (url: string, username: string, password: string) => Promise<void>;
  syncNow: () => Promise<SyncResult | null>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  resetSync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  config: null,
  status: {
    is_configured: false,
    is_syncing: false,
    last_sync_at: null,
    last_result: null,
    device_id: null,
    phase: null,
    progress: null,
  },
  isSyncing: false,
  isLoading: false,
  error: null,

  loadConfig: async () => {
    try {
      const config = await invoke<SyncConfig | null>("sync_get_config");
      set({ config });
    } catch (e) {
      console.error("Failed to load sync config:", e);
    }
  },

  loadStatus: async () => {
    try {
      const status = await invoke<SyncStatus>("sync_get_status");
      set({ status });
    } catch (e) {
      console.error("Failed to load sync status:", e);
    }
  },

  testConnection: async (url, username, password) => {
    try {
      const result = await invoke<boolean>("sync_test_connection", {
        url,
        username,
        password,
      });
      return result;
    } catch (e) {
      throw e;
    }
  },

  saveConfig: async (url, username, password) => {
    await invoke("sync_configure", { url, username, password });
    await get().loadConfig();
    await get().loadStatus();
  },

  syncNow: async () => {
    if (get().isSyncing) return null;
    set({ isSyncing: true, error: null });
    try {
      const result = await invoke<SyncResult>("sync_now");
      set({ isSyncing: false });
      await get().loadStatus();
      return result;
    } catch (e) {
      const error = String(e);
      set({ isSyncing: false, error });
      return null;
    }
  },

  setAutoSync: async (enabled) => {
    await invoke("sync_set_auto_sync", { enabled });
    await get().loadConfig();
  },

  resetSync: async () => {
    await invoke("sync_reset");
    await get().loadStatus();
  },
}));
