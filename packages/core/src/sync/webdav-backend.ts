/**
 * WebDAV sync backend implementation.
 * Wraps WebDavClient to implement ISyncBackend interface.
 */

import type { ISyncBackend, RemoteFile, WebDavConfig } from "./sync-backend";
import { REMOTE_COVERS, REMOTE_DATA, REMOTE_FILES } from "./sync-types";
import { WebDavClient } from "./webdav-client";

/**
 * WebDAV backend implementation.
 * Uses the existing WebDavClient for all operations.
 */
export class WebDavBackend implements ISyncBackend {
  readonly type = "webdav" as const;
  private client: WebDavClient;
  private config: WebDavConfig;

  constructor(config: WebDavConfig, password: string) {
    this.config = config;
    this.client = new WebDavClient(config.url, config.username, password, config.allowInsecure);
  }

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async ensureDirectories(): Promise<void> {
    // Create directories for the new simple sync (JSON-based)
    await this.client.ensureDirectory("/readany/sync");
    // Legacy directories for file sync (if needed)
    await this.client.ensureDirectory(REMOTE_DATA);
    await this.client.mkcol(REMOTE_FILES);
    await this.client.mkcol(REMOTE_COVERS);
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    await this.client.put(path, data);
  }

  async get(path: string): Promise<Uint8Array> {
    return this.client.get(path);
  }

  async getJSON<T>(path: string): Promise<T | null> {
    return this.client.getJSON<T>(path);
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    await this.client.putJSON(path, data);
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const resources = await this.client.safeReadDir(path);
    return resources.map((r) => ({
      name: r.name,
      path: r.href,
      size: r.contentLength ?? 0,
      lastModified: r.lastModified ? new Date(r.lastModified).getTime() : 0,
      isDirectory: r.isCollection,
    }));
  }

  async delete(path: string): Promise<void> {
    await this.client.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.client.exists(path);
  }

  async getDisplayName(): Promise<string> {
    const url = new URL(this.config.url);
    return `WebDAV (${url.host})`;
  }
}

/**
 * Create a WebDAV backend from configuration.
 */
export function createWebDavBackend(config: WebDavConfig, password: string): WebDavBackend {
  return new WebDavBackend(config, password);
}
