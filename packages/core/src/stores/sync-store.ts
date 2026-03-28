/**
 * Shared sync store — manages sync configuration and state for multiple backends.
 * Supports WebDAV, S3, and LAN sync.
 * Used by both desktop (Tauri) and mobile (Expo).
 */

import { create } from "zustand";
import { getPlatformService } from "../services/platform";
import type { S3Config, SyncConfig, WebDavConfig } from "../sync/sync-backend";
import { DEFAULT_SYNC_CONFIG, SYNC_CONFIG_KEY, SYNC_SECRET_KEYS } from "../sync/sync-backend";
import type { ISyncBackend } from "../sync/sync-backend";
import { createSyncBackend, getSecretKeyForBackend } from "../sync/sync-backend-factory";
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
  saveWebDavConfig: (
    url: string,
    username: string,
    password: string,
    allowInsecure?: boolean,
  ) => Promise<void>;
  testWebDavConnection: (
    url: string,
    username: string,
    password: string,
    allowInsecure?: boolean,
  ) => Promise<boolean>;

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
  syncNow: (
    resolvedDirection?: "upload" | "download",
    useIncremental?: boolean,
  ) => Promise<SyncResult | null>;
  /** Run sync using an explicitly provided backend (e.g. for LAN sync) */
  syncWithBackend: (
    backend: ISyncBackend,
    resolvedDirection?: "upload" | "download",
    useIncremental?: boolean,
  ) => Promise<SyncResult | null>;
  /** New simplified sync (JSON-based, no full db file sync) */
  syncSimple: (backend: ISyncBackend) => Promise<SyncResult | null>;
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
      console.log(`[SyncStore] loadConfig: configStr = ${configStr ? "found" : "not found"}`);
      if (configStr) {
        const config = JSON.parse(configStr) as SyncConfig;
        const secretKey = config.type !== "lan" ? getSecretKeyForBackend(config.type) : null;
        const secret = secretKey ? await platform.kvGetItem(secretKey) : null;
        console.log(
          `[SyncStore] loadConfig: secretKey = ${secretKey}, secret = ${secret ? "found" : "not found"}`,
        );

        const isConfigured =
          config.type === "lan"
            ? true
            : !!(
                secret &&
                ((config.type === "webdav" && config.url && config.username) ||
                  (config.type === "s3" && config.endpoint && config.bucket && config.accessKeyId))
              );

        console.log(
          `[SyncStore] loadConfig: isConfigured = ${isConfigured}, backendType = ${config.type}`,
        );
        set({
          config,
          isConfigured,
          backendType: config.type,
        });
      }
    } catch (e) {
      console.error("[SyncStore] loadConfig error:", e);
    }
  },

  saveWebDavConfig: async (url, username, password, allowInsecure) => {
    const platform = getPlatformService();
    const existing = get().config;
    const config: WebDavConfig = {
      type: "webdav",
      url: url.replace(/\/+$/, ""),
      username,
      allowInsecure: allowInsecure ?? (existing as WebDavConfig)?.allowInsecure ?? false,
      autoSync: (existing as WebDavConfig)?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
      syncIntervalMins:
        (existing as WebDavConfig)?.syncIntervalMins ?? DEFAULT_SYNC_CONFIG.syncIntervalMins,
      wifiOnly: (existing as WebDavConfig)?.wifiOnly ?? DEFAULT_SYNC_CONFIG.wifiOnly,
      notifyOnComplete:
        (existing as WebDavConfig)?.notifyOnComplete ?? DEFAULT_SYNC_CONFIG.notifyOnComplete,
    };
    console.log(`[SyncStore] saveWebDavConfig: saving config and password...`);
    console.log(
      `[SyncStore] saveWebDavConfig: SYNC_CONFIG_KEY = "${SYNC_CONFIG_KEY}", SYNC_SECRET_KEYS.webdav = "${SYNC_SECRET_KEYS.webdav}"`,
    );
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    await platform.kvSetItem(SYNC_SECRET_KEYS.webdav, password);

    // Verify save
    const savedPassword = await platform.kvGetItem(SYNC_SECRET_KEYS.webdav);
    console.log(
      `[SyncStore] saveWebDavConfig: password verification = ${savedPassword ? "SUCCESS" : "FAILED"}`,
    );

    set({ config, isConfigured: true, backendType: "webdav" });
  },

  testWebDavConnection: async (url, username, password, allowInsecure) => {
    const client = new WebDavClient(url, username, password, allowInsecure);
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

  syncNow: async (_resolvedDirection, _useIncremental) => {
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

    // Enforce wifiOnly setting
    if (state.config.type !== "lan" && "wifiOnly" in state.config && state.config.wifiOnly) {
      if (platform.isOnWifi) {
        const isWifi = await platform.isOnWifi();
        if (!isWifi) {
          set({ error: "Sync skipped: WiFi-only mode is enabled and device is not on WiFi" });
          return null;
        }
      }
    }

    set({ status: "checking", error: null, pendingDirection: null });

    try {
      const backend = createSyncBackend(state.config, secret || "");

      const connected = await backend.testConnection();
      if (!connected) {
        set({ status: "error", error: "无法连接到同步服务器，请检查网络和凭据", pendingDirection: null, progress: null });
        return {
          success: false,
          direction: "none",
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error: "无法连接到同步服务器，请检查网络和凭据",
        };
      }

      // Clear error on successful connection
      set({ error: null });

      // Use new simplified sync (JSON-based)
      return await get().syncSimple(backend);
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

  syncWithBackend: async (backend, _resolvedDirection, _useIncremental = true) => {
    const state = get();
    if (state.status !== "idle") return null;

    set({ status: "checking", error: null, pendingDirection: null });

    try {
      // Use new simplified sync (JSON-based, no full db file sync)
      return await get().syncSimple(backend);
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

  syncSimple: async (backend: ISyncBackend) => {
    const state = get();
    if (state.status !== "idle") return null;

    set({ status: "syncing-files", error: null, progress: null });

    try {
      const { runSimpleSync } = await import("../sync/simple-sync");

      const result = await runSimpleSync(backend, (message) => {
        set({
          progress: {
            phase: "database",
            operation: "upload",
            completedFiles: 0,
            totalFiles: 1,
            message,
          },
        });
      });

      if (result.success) {
        set({
          status: "idle",
          lastSyncAt: Date.now(),
          error: null,
          progress: null,
        });
      } else {
        set({
          status: "error",
          error: result.error || "同步失败",
          progress: null,
        });
      }

      return {
        success: result.success,
        direction: "upload" as const,
        filesUploaded: result.changes,
        filesDownloaded: 0,
        durationMs: 0,
        error: result.error,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ status: "error", error, progress: null });
      return {
        success: false,
        direction: "none" as const,
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
