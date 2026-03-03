/**
 * TauriPlatformService — IPlatformService implementation for Tauri v2 desktop.
 *
 * Wraps @tauri-apps/plugin-fs, @tauri-apps/plugin-sql, @tauri-apps/plugin-dialog,
 * @tauri-apps/api, and @tauri-apps/plugin-updater behind the core platform interface.
 *
 * All Tauri imports are dynamic so the module graph stays clean in SSR/test contexts.
 */
import type {
  IPlatformService,
  IDatabase,
  IWebSocket,
  FilePickerOptions,
  WebSocketOptions,
  UpdateInfo,
} from "@readany/core/services";

/** Adapter: wraps Tauri SQL plugin instance as IDatabase */
function wrapTauriDatabase(tauriDb: any): IDatabase {
  return {
    execute: (sql: string, params?: unknown[]) => tauriDb.execute(sql, params ?? []),
    select: <T>(sql: string, params?: unknown[]): Promise<T[]> => tauriDb.select(sql, params ?? []),
    close: () => tauriDb.close(),
  };
}

export class TauriPlatformService implements IPlatformService {
  readonly platformType = "desktop" as const;
  readonly isMobile = false;
  readonly isDesktop = true;

  // ---- File system ----

  async readFile(path: string): Promise<Uint8Array> {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return readFile(path);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, data);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, content);
  }

  async readTextFile(path: string): Promise<string> {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }

  async mkdir(path: string): Promise<void> {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return exists(path);
  }

  async getAppDataDir(): Promise<string> {
    const { appDataDir } = await import("@tauri-apps/api/path");
    return appDataDir();
  }

  async joinPath(...parts: string[]): Promise<string> {
    const { join } = await import("@tauri-apps/api/path");
    return join(...parts);
  }

  convertFileSrc(path: string): string {
    // Dynamic import can't be used for a synchronous method.
    // Use the Tauri core `convertFileSrc` which is lightweight and can be
    // eagerly imported since this file is only loaded in Tauri context.
    // We lazy-cache it on first call.
    if (!this._convertFileSrc) {
      throw new Error(
        "convertFileSrc not ready. Call initSync() first or use the async version.",
      );
    }
    return this._convertFileSrc(path);
  }

  private _convertFileSrc: ((path: string) => string) | null = null;

  /** Must be called once after construction to initialize sync utilities. */
  async initSync(): Promise<void> {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    this._convertFileSrc = convertFileSrc;
  }

  // ---- File picker ----

  async pickFile(options?: FilePickerOptions): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: options?.multiple ?? false,
      filters: options?.filters,
    });
    if (Array.isArray(result)) return result[0] ?? null;
    return result;
  }

  // ---- Database ----

  async loadDatabase(path: string): Promise<IDatabase> {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const tauriDb = await Database.load(path);
    return wrapTauriDatabase(tauriDb);
  }

  // ---- Network ----

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // Use native fetch — Tauri v2 allows it via plugin-http or the default
    return globalThis.fetch(url, options);
  }

  async createWebSocket(
    url: string,
    options?: WebSocketOptions,
  ): Promise<IWebSocket> {
    const WebSocket = (await import("@tauri-apps/plugin-websocket")).default;
    const ws = await WebSocket.connect(url, {
      headers: options?.headers,
    });

    return {
      send: (data: string | ArrayBuffer) => {
        if (typeof data === "string") {
          ws.send(data);
        } else {
          ws.send(Array.from(new Uint8Array(data)));
        }
      },
      close: () => ws.disconnect(),
      onMessage: (handler) => {
        ws.addListener((msg) => {
          if (typeof msg === "string") handler(msg);
          else if (msg && typeof msg === "object" && "data" in msg) {
            handler((msg as any).data);
          }
        });
      },
      onClose: (handler) => {
        // Tauri WS plugin sends CloseFrame as a message type
        ws.addListener((msg) => {
          if (msg && typeof msg === "object" && "type" in msg && (msg as any).type === "Close") {
            handler();
          }
        });
      },
      onError: (handler) => {
        // Tauri WS errors surface in the promise chain; limited listener support
        ws.addListener((msg) => {
          if (msg && typeof msg === "object" && "type" in msg && (msg as any).type === "Error") {
            handler((msg as any).data);
          }
        });
      },
    };
  }

  // ---- App info ----

  async getAppVersion(): Promise<string> {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }

  // ---- Update ----

  async checkUpdate(): Promise<UpdateInfo | null> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body || undefined,
      date: update.date || undefined,
    };
  }

  async installUpdate(): Promise<void> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  }
}
