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
  FetchOptions,
  FilePickerOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  WebSocketOptions,
} from "@readany/core/services";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";

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

  // ---- Language / Locale ----

  async getLocale(): Promise<string> {
    // Use React Native's I18nManager to get device locale
    const { I18nManager } = require("react-native");
    return I18nManager.localeIdentifier || "en_US";
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

  async fetch(url: string, options?: FetchOptions): Promise<Response> {
    const { allowInsecure, ...fetchOptions } = options ?? {};
    const effectiveUrl = allowInsecure ? url.replace(/^https:\/\//i, "http://") : url;
    const method = fetchOptions?.method?.toUpperCase() || "GET";

    // Always use XHR for WebDAV to handle large binary files properly
    // React Native's fetch has issues with large arrayBuffer responses
    return this._fetchWithXHR(effectiveUrl, fetchOptions);
  }

  private _fetchWithXHR(url: string, options?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const method = options?.method || "GET";

      xhr.open(method, url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = 120000; // 2 minute timeout for large file downloads

      // Set headers
      if (options?.headers) {
        const headers = options.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          xhr.setRequestHeader(key, value);
        }
      }

      xhr.onload = () => {
        try {
          const buffer = xhr.response as ArrayBuffer;

          // Create a Response-like object
          const response = {
            status: xhr.status,
            statusText: xhr.statusText,
            ok: xhr.status >= 200 && xhr.status < 300,
            headers: new Headers(),
            text: async () => {
              // Use chunked decoding for large buffers to avoid string length limits
              const CHUNK_SIZE = 65536; // 64KB chunks
              if (buffer.byteLength <= CHUNK_SIZE) {
                return new TextDecoder().decode(buffer);
              }
              const chunks: string[] = [];
              const decoder = new TextDecoder();
              let offset = 0;
              while (offset < buffer.byteLength) {
                const end = Math.min(offset + CHUNK_SIZE, buffer.byteLength);
                chunks.push(
                  decoder.decode(buffer.slice(offset, end), { stream: end < buffer.byteLength }),
                );
                offset = end;
              }
              return chunks.join("");
            },
            json: async () => {
              const text = await response.text();
              return JSON.parse(text);
            },
            arrayBuffer: async () => buffer,
          } as Response;

          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to process XHR response for ${method} ${url}: ${error}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error(`XHR request failed: ${method} ${url}`));
      };

      xhr.ontimeout = () => {
        reject(new Error(`XHR request timeout (120s): ${method} ${url}`));
      };

      // Send request
      if (options?.body) {
        if (typeof options.body === "string") {
          xhr.send(options.body);
        } else if (options.body instanceof ArrayBuffer) {
          xhr.send(options.body);
        } else if (options.body instanceof Uint8Array) {
          xhr.send(options.body);
        } else {
          xhr.send(options.body as any);
        }
      } else {
        xhr.send();
      }
    });
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

  // ---- Update (GitHub releases) ----

  async checkUpdate() {
    try {
      const response = await fetch(
        "https://api.github.com/repos/codedogQBY/ReadAny/releases/latest"
      );
      if (!response.ok) return null;

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, "");
      const currentVersion = await this.getAppVersion();

      if (this._compareVersions(latestVersion, currentVersion) > 0) {
        const apkAsset = release.assets.find(
          (a: { name: string }) => a.name === "ReadAny.apk"
        );
        if (apkAsset) {
          return {
            version: latestVersion,
            notes: release.body || undefined,
            date: release.published_at || undefined,
            downloadUrl: apkAsset.browser_download_url,
          };
        }
      }
      return null;
    } catch (e) {
      console.error("[Updater] Check failed:", e);
      return null;
    }
  }

  async installUpdate(downloadUrl?: string) {
    if (!downloadUrl) return;
    const { Linking } = await import("react-native");
    await Linking.openURL(downloadUrl);
  }

  private _compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
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
    try {
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      console.error(`[SecureStore] getItem failed for key "${key}":`, e);
      return null;
    }
  }

  async kvSetItem(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
      await this._addKeyToIndex(key);
      console.log(`[SecureStore] Saved key "${key}" successfully`);
    } catch (e) {
      console.error(`[SecureStore] setItem failed for key "${key}":`, e);
      throw e;
    }
  }

  async kvRemoveItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
      await this._removeKeyFromIndex(key);
    } catch (e) {
      console.error(`[SecureStore] deleteItem failed for key "${key}":`, e);
    }
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

  // ---- LAN Sync ----

  async isOnWifi(): Promise<boolean> {
    try {
      const state = await Network.getNetworkStateAsync();
      return state.type === Network.NetworkStateType.WIFI;
    } catch {
      return false;
    }
  }

  async getLocalIP(): Promise<string> {
    try {
      const ip = await Network.getIpAddressAsync();
      return ip ?? "";
    } catch {
      return "";
    }
  }

  async startLANServer(
    port: number,
    handler: (
      method: string,
      path: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }>,
  ): Promise<{ port: number; server: unknown }> {
    const isExpoGo =
      Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
    if (isExpoGo) {
      throw new Error(
        "由于需要底层原生 TCP 模块，局域网服务端不支持在原味 Expo Go 中运行。请使用自定义 Dev Client (expo run) 或桌面版进行互传。",
      );
    }

    let TcpSocket: any;
    let BufferMod: any;
    try {
      TcpSocket = (await import("react-native-tcp-socket")).default;
      BufferMod = (await import("buffer")).Buffer;
    } catch (e) {
      throw new Error(`Native TCP Socket unavailable: ${e instanceof Error ? e.message : e}`);
    }

    return new Promise((resolve, reject) => {
      const server = TcpSocket.createServer((socket: any) => {
        let buffer = "";

        socket.on("data", async (data: any) => {
          buffer += data.toString();

          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const headerPart = buffer.slice(0, headerEnd);
            const lines = headerPart.split("\r\n");
            if (lines.length === 0) return;

            const [method, path] = lines[0].split(" ");

            const reqHeaders: Record<string, string> = {};
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i];
              const colonPos = line.indexOf(":");
              if (colonPos !== -1) {
                const k = line.slice(0, colonPos).trim().toLowerCase();
                const v = line.slice(colonPos + 1).trim();
                reqHeaders[k] = v;
              }
            }

            buffer = ""; // clear buffer

            try {
              const response = await handler(method, path, reqHeaders);

              let resHead = `HTTP/1.1 ${response.status} OK\r\n`;
              if (response.headers) {
                for (const [k, v] of Object.entries(response.headers)) {
                  resHead += `${k}: ${v}\r\n`;
                }
              }
              resHead += "Connection: close\r\n\r\n";

              socket.write(resHead);
              if (response.body) {
                socket.write(BufferMod.from(response.body));
              }
              socket.end();
            } catch (err) {
              console.error("TCP Sync handler Error:", err);
              socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
              socket.end();
            }
          }
        });

        socket.on("error", (err: any) => {
          console.warn("Socket error:", err);
        });
      });

      server.on("error", (err: any) => {
        reject(err);
      });

      server.listen({ port, host: "0.0.0.0" }, () => {
        resolve({ port: (server.address() as any)?.port || port, server });
      });
    });
  }

  async stopLANServer(server: unknown): Promise<void> {
    if (server && typeof (server as any).close === "function") {
      (server as any).close();
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
    txt: "text/plain",
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}
