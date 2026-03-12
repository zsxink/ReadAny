/**
 * ExpoPlatformService — IPlatformService implementation for Expo / React Native.
 *
 * Uses Expo SDK 55+ modules:
 * - expo-file-system (new File/Directory/Paths API) for FS operations
 * - expo-sqlite for database
 * - expo-secure-store for KV storage
 * - expo-clipboard for clipboard
 * - expo-sharing + expo-file-system for file sharing
 * - expo-constants for app version
 */
import type {
  FilePickerOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  WebSocketOptions,
} from "@readany/core/services";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";

import * as DocumentPicker from "expo-document-picker";

/** Simple KV storage keys tracking (SecureStore doesn't have getAllKeys) */
const KV_KEYS_INDEX = "__readany_kv_keys__";

export class ExpoPlatformService implements IPlatformService {
  readonly platformType = "mobile" as const;
  readonly isMobile = true;
  readonly isDesktop = false;

  // ---- File system (expo-file-system v55 — File/Directory/Paths API) ----

  async readFile(path: string): Promise<Uint8Array> {
    const file = new File(path);
    return file.bytes();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const file = new File(path);
    file.write(data);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const file = new File(path);
    file.write(content);
  }

  async readTextFile(path: string): Promise<string> {
    const file = new File(path);
    return file.text();
  }

  async mkdir(path: string): Promise<void> {
    const dir = new Directory(path);
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  }

  async exists(path: string): Promise<boolean> {
    const info = Paths.info(path);
    return info.exists;
  }

  async deleteFile(path: string): Promise<void> {
    const file = new File(path);
    if (file.exists) {
      file.delete();
    }
  }

  async getAppDataDir(): Promise<string> {
    return Paths.document.uri;
  }

  async joinPath(...parts: string[]): Promise<string> {
    const joined = parts.join("/");
    // Preserve file:// protocol prefix while collapsing duplicate slashes in path
    const match = joined.match(/^(file:\/\/)(\/.*)/);
    if (match) {
      return match[1] + match[2].replace(/\/+/g, "/");
    }
    return joined.replace(/\/+/g, "/");
  }

  convertFileSrc(path: string): string {
    // In RN, file:// URIs can be used directly by Image/WebView
    if (path.startsWith("file://")) return path;
    return `file://${path}`;
  }

  // ---- File picker (expo-document-picker) ----

  async pickFile(options?: FilePickerOptions): Promise<string | string[] | null> {
    try {
      // Convert extension-based filters to MIME types for expo-document-picker
      const mimeTypes: string[] = [];
      if (options?.filters) {
        for (const filter of options.filters) {
          for (const ext of filter.extensions) {
            const mime = extensionToMime(ext);
            if (mime && !mimeTypes.includes(mime)) {
              mimeTypes.push(mime);
            }
          }
        }
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: mimeTypes.length > 0 ? mimeTypes : ["*/*"],
        multiple: options?.multiple ?? false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      if (options?.multiple) {
        return result.assets.map((a) => a.uri);
      }
      return result.assets[0].uri;
    } catch {
      return null;
    }
  }

  // ---- Database (expo-sqlite) ----

  async loadDatabase(path: string): Promise<IDatabase> {
    const SQLite = await import("expo-sqlite");
    // expo-sqlite uses db name, not full path
    const dbName = path.replace(/^.*[\\/]/, "").replace("sqlite:", "");
    const db = await SQLite.openDatabaseAsync(dbName);

    return {
      async execute(sql: string, params?: unknown[]): Promise<void> {
        await db.runAsync(sql, ...((params as (string | number | null)[]) ?? []));
      },
      async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
        const rows = await db.getAllAsync(sql, ...((params as (string | number | null)[]) ?? []));
        return rows as T[];
      },
      async close(): Promise<void> {
        await db.closeAsync();
      },
    };
  }

  // ---- Network ----

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // React Native has built-in fetch
    return globalThis.fetch(url, options);
  }

  async createWebSocket(url: string, _options?: WebSocketOptions): Promise<IWebSocket> {
    // RN has built-in WebSocket (note: custom headers not supported like Tauri)
    const ws = new WebSocket(url);

    return {
      send(data: string | ArrayBuffer) {
        ws.send(data);
      },
      close() {
        ws.close();
      },
      onMessage(handler) {
        ws.onmessage = (evt) => handler(evt.data);
      },
      onClose(handler) {
        ws.onclose = () => handler();
      },
      onError(handler) {
        ws.onerror = (err) => handler(err);
      },
    };
  }

  // ---- App info ----

  async getAppVersion(): Promise<string> {
    return Constants.expoConfig?.version ?? "1.0.0";
  }

  // ---- Update (noop — mobile uses app stores) ----

  async checkUpdate() {
    return null;
  }

  async installUpdate() {
    // noop
  }

  // ---- KV Storage (backed by expo-secure-store) ----

  private async _getKeysIndex(): Promise<string[]> {
    try {
      const raw = await SecureStore.getItemAsync(KV_KEYS_INDEX);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private async _addKeyToIndex(key: string): Promise<void> {
    const keys = await this._getKeysIndex();
    if (!keys.includes(key)) {
      keys.push(key);
      await SecureStore.setItemAsync(KV_KEYS_INDEX, JSON.stringify(keys));
    }
  }

  private async _removeKeyFromIndex(key: string): Promise<void> {
    const keys = await this._getKeysIndex();
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      keys.splice(idx, 1);
      await SecureStore.setItemAsync(KV_KEYS_INDEX, JSON.stringify(keys));
    }
  }

  async kvGetItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  async kvSetItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
    await this._addKeyToIndex(key);
  }

  async kvRemoveItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
    await this._removeKeyFromIndex(key);
  }

  async kvGetAllKeys(): Promise<string[]> {
    return this._getKeysIndex();
  }

  // ---- Clipboard ----

  async copyToClipboard(content: string): Promise<void> {
    await Clipboard.setStringAsync(content);
  }

  // ---- File sharing / download ----

  async shareOrDownloadFile(content: string, filename: string, mimeType: string): Promise<void> {
    const cacheDir = Paths.cache;
    const file = new File(cacheDir, filename);
    file.write(content);

    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(file.uri, { mimeType });
    } else {
      console.warn("Sharing not available on this device");
    }
  }
}

/** Map book file extensions to MIME types for document picker */
function extensionToMime(ext: string): string {
  const map: Record<string, string> = {
    epub: "application/epub+zip",
    pdf: "application/pdf",
    mobi: "application/x-mobipocket-ebook",
    azw: "application/vnd.amazon.ebook",
    azw3: "application/vnd.amazon.ebook",
    cbz: "application/vnd.comicbook+zip",
    fb2: "application/x-fictionbook+xml",
    fbz: "application/x-zip-compressed-fb2",
    // Common archive types that may contain books
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}
