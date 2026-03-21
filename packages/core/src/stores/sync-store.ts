/**
 * Shared sync store — manages sync configuration and state for multiple backends.
 * Supports WebDAV, S3, and LAN sync.
 * Used by both desktop (Tauri) and mobile (Expo).
 */

import { create } from "zustand";
import { getVectorDB, hasVectorDB } from "../rag/vector-db";
import { getPlatformService } from "../services/platform";
import type { S3Config, SyncConfig, WebDavConfig } from "../sync/sync-backend";
import { DEFAULT_SYNC_CONFIG, SYNC_CONFIG_KEY, SYNC_SECRET_KEYS } from "../sync/sync-backend";
import { createSyncBackend, getSecretKeyForBackend } from "../sync/sync-backend-factory";
import { determineSyncDirection, runSync } from "../sync/sync-engine";
import type { SyncDirection, SyncProgress, SyncResult, SyncStatusType } from "../sync/sync-types";
import { WebDavClient } from "../sync/webdav-client";

export interface SyncState {
  // Config
  config: SyncConfig | null;
  isConfigured: boolean;
  backendType: "webdav" | "s3" | "lan" | null;

  // Runtime state
  status: SyncStatusType;
  lastSyncAt: number | null;
  lastResult: SyncResult | null;
  error: string | null;
  progress: SyncProgress | null;

  // Conflict resolution
  pendingDirection: SyncDirection | null;

  // Actions
  loadConfig: () => Promise<void>;

  // WebDAV actions
  saveWebDavConfig: (url: string, username: string, password: string) => Promise<void>;
  testWebDavConnection: (url: string, username: string, password: string) => Promise<boolean>;

  // S3 actions
  saveS3Config: (
    config: Omit<
      S3Config,
      "type" | "autoSync" | "syncIntervalMins" | "wifiOnly" | "notifyOnComplete"
    >,
    secretAccessKey: string,
  ) => Promise<void>;
  testS3Connection: (
    config: Omit<
      S3Config,
      "type" | "autoSync" | "syncIntervalMins" | "wifiOnly" | "notifyOnComplete"
    >,
    secretAccessKey: string,
  ) => Promise<boolean>;

  // Sync actions
  syncNow: (resolvedDirection?: "upload" | "download") => Promise<SyncResult | null>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  setWifiOnly: (enabled: boolean) => Promise<void>;
  setNotifyOnComplete: (enabled: boolean) => Promise<void>;
  resetSync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  config: null,
  isConfigured: false,
  backendType: null,
  status: "idle",
  lastSyncAt: null,
  lastResult: null,
  error: null,
  progress: null,
  pendingDirection: null,

  loadConfig: async () => {
    try {
      const platform = getPlatformService();
      const configStr = await platform.kvGetItem(SYNC_CONFIG_KEY);
      if (configStr) {
        const config = JSON.parse(configStr) as SyncConfig;
        const secretKey = config.type !== "lan" ? getSecretKeyForBackend(config.type) : null;
        const secret = secretKey ? await platform.kvGetItem(secretKey) : null;

        const isConfigured =
          config.type === "lan"
            ? true
            : !!(
                secret &&
                ((config.type === "webdav" && config.url && config.username) ||
                  (config.type === "s3" && config.endpoint && config.bucket && config.accessKeyId))
              );

        set({
          config,
          isConfigured,
          backendType: config.type,
        });
      }
    } catch {
      // Config not yet saved — that's fine
    }
  },

  saveWebDavConfig: async (url, username, password) => {
    const platform = getPlatformService();
    const existing = get().config;
    const config: WebDavConfig = {
      type: "webdav",
      url: url.replace(/\/+$/, ""),
      username,
      autoSync: (existing as WebDavConfig)?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
      syncIntervalMins:
        (existing as WebDavConfig)?.syncIntervalMins ?? DEFAULT_SYNC_CONFIG.syncIntervalMins,
      wifiOnly: (existing as WebDavConfig)?.wifiOnly ?? DEFAULT_SYNC_CONFIG.wifiOnly,
      notifyOnComplete:
        (existing as WebDavConfig)?.notifyOnComplete ?? DEFAULT_SYNC_CONFIG.notifyOnComplete,
    };
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    await platform.kvSetItem(SYNC_SECRET_KEYS.webdav, password);
    set({ config, isConfigured: true, backendType: "webdav" });
  },

  testWebDavConnection: async (url, username, password) => {
    const client = new WebDavClient(url, username, password);
    return client.testConnection();
  },

  saveS3Config: async (s3Config, secretAccessKey) => {
    const platform = getPlatformService();
    const existing = get().config;
    const config: S3Config = {
      ...s3Config,
      type: "s3",
      autoSync: (existing as S3Config)?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
      syncIntervalMins:
        (existing as S3Config)?.syncIntervalMins ?? DEFAULT_SYNC_CONFIG.syncIntervalMins,
      wifiOnly: (existing as S3Config)?.wifiOnly ?? DEFAULT_SYNC_CONFIG.wifiOnly,
      notifyOnComplete:
        (existing as S3Config)?.notifyOnComplete ?? DEFAULT_SYNC_CONFIG.notifyOnComplete,
    };
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    await platform.kvSetItem(SYNC_SECRET_KEYS.s3, secretAccessKey);
    set({ config, isConfigured: true, backendType: "s3" });
  },

  testS3Connection: async (s3Config, secretAccessKey) => {
    try {
      const config: S3Config = {
        ...s3Config,
        type: "s3",
        autoSync: false,
        syncIntervalMins: 30,
        wifiOnly: false,
        notifyOnComplete: true,
      };
      const backend = createSyncBackend(config, secretAccessKey);
      return backend.testConnection();
    } catch {
      return false;
    }
  },

  syncNow: async (resolvedDirection) => {
    const state = get();
    if (state.status !== "idle") return null;
    if (!state.isConfigured || !state.config) {
      set({ error: "Sync not configured" });
      return null;
    }

    const platform = getPlatformService();
    const secretKey =
      state.config.type !== "lan" ? getSecretKeyForBackend(state.config.type) : null;
    const secret = secretKey ? await platform.kvGetItem(secretKey) : null;

    if (state.config.type !== "lan" && !secret) {
      set({ error: "No credentials configured" });
      return null;
    }

    set({ status: "checking", error: null, pendingDirection: null });

    try {
      // Create backend instance
      const backend = createSyncBackend(state.config, secret || "");

      // Test connection
      const connected = await backend.testConnection();
      if (!connected) {
        throw new Error("Failed to connect to sync backend");
      }

      let direction: "upload" | "download";
      let remoteManifest: import("../sync/sync-types").RemoteSyncManifest | null = null;

      if (resolvedDirection) {
        direction = resolvedDirection;
      } else {
        // Determine direction automatically
        const result = await determineSyncDirection(backend);
        remoteManifest = result.remoteManifest;

        if (result.direction === "none") {
          set({ status: "idle", lastSyncAt: Date.now() });
          return {
            success: true,
            direction: "none",
            filesUploaded: 0,
            filesDownloaded: 0,
            durationMs: 0,
          };
        }

        if (result.direction === "conflict") {
          set({ status: "idle", pendingDirection: "conflict" });
          return null;
        }

        direction = result.direction;
      }

      // Execute sync
      set({
        status: direction === "upload" ? "uploading" : "downloading",
        progress: null,
      });

      const onProgress = (progress: SyncProgress) => {
        set({ progress });
      };

      const onDatabaseReplaced = async () => {
        if (hasVectorDB()) {
          const vectorDB = getVectorDB();
          if (vectorDB?.rebuild && (await vectorDB.isReady())) {
            console.log("[Sync] Rebuilding vector index after download...");
            try {
              const count = await vectorDB.rebuild();
              console.log(`[Sync] Rebuilt ${count} vectors`);
            } catch (e) {
              console.error("[Sync] Failed to rebuild vector index:", e);
            }
          }
        }
      };

      const syncResult = await runSync(
        backend,
        direction,
        onProgress,
        remoteManifest,
        onDatabaseReplaced,
      );

      set({
        status: "idle",
        lastSyncAt: Date.now(),
        lastResult: syncResult,
        error: syncResult.error || null,
        pendingDirection: null,
        progress: null,
      });

      return syncResult;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ status: "error", error, pendingDirection: null, progress: null });
      return {
        success: false,
        direction: "none",
        filesUploaded: 0,
        filesDownloaded: 0,
        durationMs: 0,
        error,
      };
    }
  },

  setAutoSync: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, autoSync: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  setWifiOnly: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, wifiOnly: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  setNotifyOnComplete: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, notifyOnComplete: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  resetSync: async () => {
    const platform = getPlatformService();
    await platform.kvRemoveItem(SYNC_CONFIG_KEY);
    await platform.kvRemoveItem(SYNC_SECRET_KEYS.webdav);
    await platform.kvRemoveItem(SYNC_SECRET_KEYS.s3);
    set({
      config: null,
      isConfigured: false,
      backendType: null,
      status: "idle",
      lastSyncAt: null,
      lastResult: null,
      error: null,
      progress: null,
      pendingDirection: null,
    });
  },
}));
