import { closeDB, initDatabase, resetDBCache } from "@readany/core/db";
/**
 * Desktop (Tauri) sync adapter — implements ISyncAdapter
 * using Tauri invoke commands and @tauri-apps/plugin-fs.
 */
import type { ISyncAdapter } from "@readany/core/sync";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join, tempDir } from "@tauri-apps/api/path";
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";

export class DesktopSyncAdapter implements ISyncAdapter {
  private isRelativePath(p: string): boolean {
    return (
      !p.startsWith("/") &&
      !p.startsWith("file://") &&
      !p.startsWith("asset://") &&
      !p.startsWith("http")
    );
  }

  private async resolveToAbsolute(path: string): Promise<string> {
    if (this.isRelativePath(path)) {
      const appData = await appDataDir();
      return await join(appData, path);
    }
    return path;
  }

  async vacuumInto(targetPath: string): Promise<void> {
    await invoke("sync_vacuum_into", { targetPath });
  }

  async integrityCheck(dbPath: string): Promise<boolean> {
    return invoke<boolean>("sync_integrity_check", { dbPath });
  }

  async closeDatabase(): Promise<void> {
    await closeDB();
  }

  async reopenDatabase(): Promise<void> {
    resetDBCache();
    await initDatabase();
  }

  async getDatabasePath(): Promise<string> {
    const dir = await appDataDir();
    return await join(dir, "readany.db");
  }

  async getTempDir(): Promise<string> {
    return tempDir();
  }

  async getAppDataDir(): Promise<string> {
    return appDataDir();
  }

  async hashFile(filePath: string): Promise<string> {
    const resolved = await this.resolveToAbsolute(filePath);
    return invoke<string>("sync_hash_file", { path: resolved });
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const resolved = await this.resolveToAbsolute(filePath);
    return readFile(resolved);
  }

  async writeFileBytes(filePath: string, data: Uint8Array): Promise<void> {
    const resolved = await this.resolveToAbsolute(filePath);
    await writeFile(resolved, data);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const resolvedSrc = await this.resolveToAbsolute(src);
    const resolvedDest = await this.resolveToAbsolute(dest);
    await copyFile(resolvedSrc, resolvedDest);
  }

  async deleteFile(filePath: string): Promise<void> {
    const resolved = await this.resolveToAbsolute(filePath);
    await remove(resolved);
  }

  async fileExists(filePath: string): Promise<boolean> {
    const resolved = await this.resolveToAbsolute(filePath);
    return exists(resolved);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const resolved = await this.resolveToAbsolute(dirPath);
    try {
      const entries = await readDir(resolved);
      return entries
        .filter((e) => e.isFile)
        .map((e) => e.name)
        .filter((n): n is string => !!n);
    } catch {
      return [];
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    const resolved = await this.resolveToAbsolute(dirPath);
    await mkdir(resolved, { recursive: true });
  }

  joinPath(...segments: string[]): string {
    // Simple synchronous path join for use in sync engine
    return segments.join("/").replace(/\/+/g, "/");
  }

  async getAppVersion(): Promise<string> {
    return getVersion();
  }

  async getDeviceName(): Promise<string> {
    return `Desktop-${navigator.platform || "unknown"}`;
  }
}
