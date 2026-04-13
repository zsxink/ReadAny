/**
 * Sync engine — orchestrates the full sync flow.
 * Delegates to specialized modules for metadata, direction, transfer, and file sync.
 */

import type { ISyncBackend } from "./sync-backend";
import { type SyncFilesOptions, syncFiles } from "./sync-files";
import { acquireSyncLock } from "./sync-meta";
import { executeDownload, executeUpload } from "./sync-transfer";
import type { RemoteSyncManifest, SyncProgress, SyncResult } from "./sync-types";

// Re-export public API from sub-modules for backwards compatibility
export { determineSyncDirection } from "./sync-direction";
export { syncFiles, type SyncFilesOptions } from "./sync-files";
export { downloadBookFile } from "./sync-files";

/**
 * Run the full sync flow.
 *
 * @param backend Sync backend instance
 * @param direction The sync direction (if "conflict", caller must resolve first)
 * @param onProgress Optional callback to report sync progress
 * @returns SyncResult
 */
export async function runSync(
  backend: ISyncBackend,
  direction: "upload" | "download",
  onProgress?: (progress: SyncProgress) => void,
  remoteManifest?: RemoteSyncManifest | null,
  onDatabaseReplaced?: () => Promise<void>,
  useIncremental?: boolean,
  fileSyncOptions: SyncFilesOptions = {},
): Promise<SyncResult> {
  const releaseLock = await acquireSyncLock();
  const startTime = Date.now();
  console.log(
    `[Sync] 🚀 Starting sync: direction=${direction}, incremental=${useIncremental ?? false}`,
  );

  try {
    console.log("[Sync] Ensuring remote directory structure...");
    const dirStart = Date.now();
    try {
      await backend.ensureDirectories();
      console.log(`[Sync] ✓ Directories ready in ${Date.now() - dirStart}ms`);
    } catch (error) {
      console.warn("[Sync] ⚠️ Failed to create directories (they might already exist):", error);
      console.log("[Sync] Continuing with sync anyway...");
    }

    if (useIncremental) {
      const { runIncrementalSync, getLastSyncTimestamp } = await import("./incremental-sync");
      const lastSync = await getLastSyncTimestamp();

      // For first sync (upload when no remote data exists), use full upload
      if (direction === "upload" && lastSync === 0) {
        console.log("[Sync] First sync, using full upload");
        await executeUpload(backend, onProgress);
        const { filesUploaded, filesDownloaded } = await syncFiles(
          backend,
          onProgress,
          fileSyncOptions,
        );
        return {
          success: true,
          direction,
          filesUploaded,
          filesDownloaded,
          durationMs: Date.now() - startTime,
        };
      }

      const result = await runIncrementalSync(backend, direction, (msg) => {
        onProgress?.({
          phase: "database",
          operation: direction === "upload" ? "upload" : "download",
          completedFiles: 0,
          totalFiles: 1,
          message: msg,
        });
      });

      if (result.needsFullSync) {
        console.log("[Sync] Incremental sync not possible, falling back to full sync");
        if (direction === "upload") {
          await executeUpload(backend, onProgress);
        } else {
          await executeDownload(backend, remoteManifest ?? null, onProgress);
          if (onDatabaseReplaced) {
            console.log("[Sync] Running post-download callback...");
            await onDatabaseReplaced();
          }
        }
      }

      const { filesUploaded, filesDownloaded } = await syncFiles(
        backend,
        onProgress,
        fileSyncOptions,
      );

      return {
        success: result.success,
        direction,
        filesUploaded,
        filesDownloaded,
        durationMs: Date.now() - startTime,
        error: result.error,
      };
    }

    if (direction === "upload") {
      await executeUpload(backend, onProgress);
    } else {
      await executeDownload(backend, remoteManifest ?? null, onProgress);
      if (onDatabaseReplaced) {
        console.log("[Sync] Running post-download callback...");
        await onDatabaseReplaced();
      }
    }

    const { filesUploaded, filesDownloaded } = await syncFiles(
      backend,
      onProgress,
      fileSyncOptions,
    );

    return {
      success: true,
      direction,
      filesUploaded,
      filesDownloaded,
      durationMs: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      direction,
      filesUploaded: 0,
      filesDownloaded: 0,
      durationMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    releaseLock();
  }
}
