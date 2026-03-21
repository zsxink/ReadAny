/**
 * LAN sync server implementation.
 * Provides a local HTTP server for peer-to-peer sync.
 */

import { getPlatformService } from "../services/platform";
import { getSyncAdapter } from "./sync-adapter";
import { type LANQRData, createLANQRData, generatePairCode } from "./lan-backend";
import type { ISyncBackend, RemoteFile } from "./sync-backend";

/**
 * Local filesystem backend for the LAN server.
 * Serves files from the device's own data directory for sync.
 */
class LocalFsBackend implements ISyncBackend {
  readonly type = "lan" as const;
  private appDataDir: string | null = null;

  private async getDataDir(): Promise<string> {
    if (this.appDataDir) return this.appDataDir;
    const adapter = getSyncAdapter();
    this.appDataDir = await adapter.getAppDataDir();
    return this.appDataDir;
  }

  async testConnection(): Promise<boolean> { return true; }
  async ensureDirectories(): Promise<void> {}

  async put(path: string, data: Uint8Array): Promise<void> {
    const platform = getPlatformService();
    const dataDir = await this.getDataDir();
    await platform.writeFile(dataDir + "/" + path, data);
  }

  async get(path: string): Promise<Uint8Array> {
    const platform = getPlatformService();
    const dataDir = await this.getDataDir();
    return platform.readFile(dataDir + "/" + path);
  }

  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch { return null; }
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    await this.put(path, new TextEncoder().encode(JSON.stringify(data)));
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const adapter = getSyncAdapter();
    const dataDir = await this.getDataDir();
    const fullPath = dataDir + "/" + path;
    try {
      const names = await adapter.listFiles(fullPath);
      return names.map((name) => ({
        name,
        path: path + "/" + name,
        size: 0,
        lastModified: 0,
        isDirectory: false,
      }));
    } catch { return []; }
  }

  async delete(path: string): Promise<void> {
    const platform = getPlatformService();
    const dataDir = await this.getDataDir();
    await platform.deleteFile(dataDir + "/" + path);
  }

  async exists(path: string): Promise<boolean> {
    const adapter = getSyncAdapter();
    const dataDir = await this.getDataDir();
    return adapter.fileExists(dataDir + "/" + path);
  }

  async getDisplayName(): Promise<string> { return "Local Filesystem"; }
}

export type { LANQRData } from "./lan-backend";

/** LAN server state */
export type LANServerStatus = "idle" | "starting" | "running" | "stopping" | "error";

/** LAN server event handlers */
export interface LANServerEvents {
  onStatusChange?: (status: LANServerStatus) => void;
  onClientConnect?: (clientIp: string) => void;
  onClientDisconnect?: (clientIp: string) => void;
  onError?: (error: string) => void;
}

/** LAN server configuration */
export interface LANServerConfig {
  port?: number;
  deviceName: string;
  events?: LANServerEvents;
}

/**
 * LAN sync server for sharing data with another device.
 * This runs a local HTTP server that serves files for download.
 */
export class LANServer {
  private status: LANServerStatus = "idle";
  private port: number;
  private deviceName: string;
  private pairCode: string;
  private qrData: LANQRData | null = null;
  private events: LANServerEvents;
  private backend: ISyncBackend | null = null;
  private abortController: AbortController | null = null;
  private serverHandle: unknown = null;
  private manualIP: string | null = null;

  constructor(config: LANServerConfig) {
    this.port = config.port ?? 0; // 0 means auto-assign
    this.deviceName = config.deviceName;
    this.pairCode = generatePairCode();
    this.events = config.events ?? {};
  }

  /** Get current server status */
  getStatus(): LANServerStatus {
    return this.status;
  }

  /** Get the pair code for this server */
  getPairCode(): string {
    return this.pairCode;
  }

  /** Get QR code data for this server */
  getQRData(): LANQRData | null {
    return this.qrData;
  }

  /** Get the port the server is listening on */
  getPort(): number {
    return this.port;
  }

  /** Set the sync backend to serve data from */
  setBackend(backend: ISyncBackend): void {
    this.backend = backend;
  }

  /** Set manual IP address (used when auto-detection fails) */
  setManualIP(ip: string): void {
    this.manualIP = ip;
  }

  /** Start the LAN server */
  async start(): Promise<void> {
    if (this.status === "running") {
      return;
    }

    this.setStatus("starting");

    try {
      const platform = getPlatformService();

      // Get local IP address (use manual IP if set)
      let localIp = this.manualIP;
      if (!localIp) {
        localIp = await this.getLocalIP();
      }
      if (!localIp) {
        throw new Error("Could not determine local IP address");
      }

      // Start HTTP server
      const { port, server } = (await platform.startLANServer?.(
        this.port,
        this.handleRequest.bind(this),
      )) ?? { port: this.port, server: null };

      if (!port) {
        throw new Error("Failed to start LAN server");
      }

      this.port = port;
      this.serverHandle = server;
      this.abortController = new AbortController();

      // Attach local-fs backend automatically if caller didn't set one
      if (!this.backend) {
        this.backend = new LocalFsBackend();
      }

      // Create QR data
      this.qrData = createLANQRData(localIp, this.port, this.deviceName, this.pairCode);

      this.setStatus("running");
      console.log(`[LAN Server] Started on ${localIp}:${this.port}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.setStatus("error");
      this.events.onError?.(error);
      throw e;
    }
  }

  /** Stop the LAN server */
  async stop(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.setStatus("stopping");

    try {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

      const platform = getPlatformService();
      await platform.stopLANServer?.(this.serverHandle);

      this.serverHandle = null;
      this.qrData = null;
      this.setStatus("idle");
      console.log("[LAN Server] Stopped");
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.setStatus("error");
      this.events.onError?.(error);
      throw e;
    }
  }

  /** Handle incoming HTTP request */
  private async handleRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }> {
    // Verify pair code (headers may be lowercased by HTTP layer)
    const pairCodeKey = Object.keys(headers).find(k => k.toLowerCase() === "x-pair-code");
    const clientPairCode = pairCodeKey ? headers[pairCodeKey] : undefined;
    if (clientPairCode !== this.pairCode) {
      console.warn(`[LAN Server] Pair code mismatch: got "${clientPairCode}", expected "${this.pairCode}"`);
      return { status: 403, body: new TextEncoder().encode("Forbidden") };
    }

    // Ping endpoint — no backend required
    if (method === "GET" && path === "/ping") {
      return { status: 200, body: new TextEncoder().encode("pong") };
    }

    if (!this.backend) {
      return { status: 503, body: new TextEncoder().encode("Service Unavailable") };
    }

    try {
      // File download
      if (method === "GET" && path.startsWith("/file/")) {
        const filePath = path.substring(6); // Remove "/file/" prefix
        const data = await this.backend.get(filePath);
        return {
          status: 200,
          body: data,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(data.length),
          },
        };
      }

      // Directory listing
      if (method === "GET" && path.startsWith("/list/")) {
        const dirPath = path.substring(6); // Remove "/list/" prefix
        const files = await this.backend.listDir(dirPath);
        const body = new TextEncoder().encode(JSON.stringify(files));
        return {
          status: 200,
          body,
          headers: {
            "Content-Type": "application/json",
          },
        };
      }

      // File exists check
      if (method === "HEAD" && path.startsWith("/exists/")) {
        const filePath = path.substring(8); // Remove "/exists/" prefix
        const exists = await this.backend.exists(filePath);
        return { status: exists ? 200 : 404 };
      }

      return { status: 404, body: new TextEncoder().encode("Not Found") };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[LAN Server] Error handling ${method} ${path}:`, error);
      return { status: 500, body: new TextEncoder().encode(error) };
    }
  }

  /** Get local IP address */
  private async getLocalIP(): Promise<string | null> {
    try {
      const platform = getPlatformService();
      const ip = await platform.getLocalIP?.();
      return ip ?? null;
    } catch {
      return null;
    }
  }

  /** Update server status and notify listeners */
  private setStatus(status: LANServerStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }
}

/**
 * Create a LAN sync server.
 */
export function createLANServer(config: LANServerConfig): LANServer {
  return new LANServer(config);
}
