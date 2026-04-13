/**
 * Sync transfer operations — upload and download database snapshots.
 */

import { clearVectorizationFlagsWithoutLocalChunks, getDB, getDeviceId } from "../db/database";
import { getPlatformService } from "../services/platform";
import { getSyncAdapter } from "./sync-adapter";
import type { ISyncBackend } from "./sync-backend";
import { batchSetSyncMeta } from "./sync-meta";
import {
  REMOTE_DB_FILE,
  REMOTE_DELTA_FILE,
  REMOTE_MANIFEST,
  type RemoteSyncManifest,
  SYNC_META_KEYS,
  SYNC_SCHEMA_VERSION,
  type SyncProgress,
} from "./sync-types";

/**
 * Helper: Run tasks in parallel with concurrency limit
 */
export async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Execute the upload phase: snapshot local DB → upload to backend.
 */
export async function executeUpload(
  backend: ISyncBackend,
  onProgress?: (progress: SyncProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  console.log("[Sync] 📤 Starting database upload...");

  onProgress?.({
    phase: "database",
    operation: "upload",
    completedFiles: 0,
    totalFiles: 1,
    message: "Uploading database...",
  });
  const adapter = getSyncAdapter();
  const tempDir = await adapter.getTempDir();
  const snapshotPath = adapter.joinPath(tempDir, `readany_snapshot_${Date.now()}.db`);

  try {
    // 1. Create clean snapshot via VACUUM INTO
    console.log("[Sync] Creating database snapshot...");
    const vacuumStart = Date.now();
    await adapter.vacuumInto(snapshotPath);
    console.log(`[Sync] ✓ Snapshot created in ${Date.now() - vacuumStart}ms`);

    const snapshotDb = await getPlatformService().loadDatabase(snapshotPath);
    try {
      await snapshotDb.execute(
        "UPDATE books SET is_vectorized = 0, vectorize_progress = 0 WHERE is_vectorized != 0 OR vectorize_progress != 0",
      );
      await snapshotDb.execute(
        "DELETE FROM sync_metadata WHERE key IN ('device_id', 'last_sync_at', 'last_remote_modified_at', 'last_sync_db_hash')",
      );
    } finally {
      await snapshotDb.close();
    }

    // 2. Read snapshot into memory
    const readStart = Date.now();
    const data = await adapter.readFileBytes(snapshotPath);
    const sizeKB = (data.length / 1024).toFixed(2);
    console.log(`[Sync] ✓ Read snapshot (${sizeKB} KB) in ${Date.now() - readStart}ms`);

    // 3. Upload to backend
    console.log(`[Sync] Uploading database (${sizeKB} KB)...`);
    const uploadStart = Date.now();
    await backend.put(REMOTE_DB_FILE, data);
    console.log(`[Sync] ✓ Database uploaded in ${Date.now() - uploadStart}ms`);

    // 4. Also upload delta file for incremental sync support
    try {
      const { collectLocalChanges, getDeviceId } = await import("./incremental-sync");
      const deviceId = await getDeviceId();
      const delta = await collectLocalChanges(0);
      if (delta) {
        await backend.putJSON(REMOTE_DELTA_FILE, delta);
        console.log("[Sync] ✓ Delta file uploaded for incremental sync support");
      }

      // 5. Upload manifest with lastSyncAt for incremental sync compatibility
      const now = Date.now();
      const manifest = {
        lastModifiedAt: now,
        lastSyncAt: now,
        deviceId,
        uploadedBy: await adapter.getDeviceName(),
        appVersion: await adapter.getAppVersion(),
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      await backend.putJSON(REMOTE_MANIFEST, manifest);

      // Update local sync metadata
      const dbPath = await adapter.getDatabasePath();
      const dbHash = await adapter.hashFile(dbPath);
      await batchSetSyncMeta([
        [SYNC_META_KEYS.LAST_SYNC_DB_HASH, dbHash],
        [SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT, String(now)],
        [SYNC_META_KEYS.LAST_SYNC_AT, String(now)],
      ]);

      console.log(`[Sync] ✅ Database upload completed in ${Date.now() - startTime}ms`);
    } catch (e) {
      console.warn("[Sync] Failed to upload delta file:", e);
      // Fallback to basic manifest
      const now = Date.now();
      const manifest: RemoteSyncManifest = {
        lastModifiedAt: now,
        uploadedBy: await adapter.getDeviceName(),
        appVersion: await adapter.getAppVersion(),
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      await backend.putJSON(REMOTE_MANIFEST, manifest);

      // Update local sync metadata
      const dbPath = await adapter.getDatabasePath();
      const dbHash = await adapter.hashFile(dbPath);
      await batchSetSyncMeta([
        [SYNC_META_KEYS.LAST_SYNC_DB_HASH, dbHash],
        [SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT, String(now)],
        [SYNC_META_KEYS.LAST_SYNC_AT, String(now)],
      ]);

      console.log(`[Sync] ✅ Database upload completed in ${Date.now() - startTime}ms`);
    }
  } finally {
    // Clean up snapshot
    try {
      if (await adapter.fileExists(snapshotPath)) {
        await adapter.deleteFile(snapshotPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Execute the download phase: download remote DB → validate → backup → replace.
 */
export async function executeDownload(
  backend: ISyncBackend,
  remoteManifest: RemoteSyncManifest | null,
  onProgress?: (progress: SyncProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  console.log("[Sync] 📥 Starting database download...");

  onProgress?.({
    phase: "database",
    operation: "download",
    completedFiles: 0,
    totalFiles: 1,
    message: "Downloading database...",
  });
  const adapter = getSyncAdapter();
  const tempDir = await adapter.getTempDir();
  const dbPath = await adapter.getDatabasePath();
  const tempDbPath = adapter.joinPath(tempDir, `readany_download_${Date.now()}.db`);
  const backupPath = adapter.joinPath(tempDir, `readany_backup_${Date.now()}.db`);

  try {
    // 1. Download remote DB to temp file
    console.log("[Sync] Downloading database...");
    const downloadStart = Date.now();
    const data = await backend.get(REMOTE_DB_FILE);
    const sizeKB = (data.length / 1024).toFixed(2);
    console.log(`[Sync] ✓ Downloaded database (${sizeKB} KB) in ${Date.now() - downloadStart}ms`);

    await adapter.writeFileBytes(tempDbPath, data);

    // 2. Validate integrity
    console.log("[Sync] Validating database integrity...");
    const validateStart = Date.now();
    const isValid = await adapter.integrityCheck(tempDbPath);
    if (!isValid) {
      throw new Error("Downloaded database failed integrity check. Sync aborted.");
    }
    console.log(`[Sync] ✓ Integrity check passed in ${Date.now() - validateStart}ms`);

    // 3. Backup current DB
    if (await adapter.fileExists(dbPath)) {
      console.log("[Sync] Backing up current database...");
      await adapter.copyFile(dbPath, backupPath);
    }

    // 4. Close active connection
    console.log("[Sync] Closing database connection...");
    await adapter.closeDatabase();

    // 5. Replace DB file
    console.log("[Sync] Replacing database file...");
    await adapter.copyFile(tempDbPath, dbPath);

    // 6. Reopen database
    console.log("[Sync] Reopening database...");
    await adapter.reopenDatabase();

    // 7. Clear any stale vectorization flags that refer to missing local chunks,
    // then verify the reopened DB works.
    await clearVectorizationFlagsWithoutLocalChunks();
    const db = await getDB();
    await db.select<unknown[]>("SELECT COUNT(*) as c FROM books", []);
    await getDeviceId();

    // 8. Update sync metadata (reuse manifest from caller, batch write)
    const dbHash = await adapter.hashFile(dbPath);
    const metaEntries: [string, string][] = [
      [SYNC_META_KEYS.LAST_SYNC_DB_HASH, dbHash],
      [SYNC_META_KEYS.LAST_SYNC_AT, String(Date.now())],
    ];
    if (remoteManifest) {
      metaEntries.push([
        SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT,
        String(remoteManifest.lastModifiedAt),
      ]);
    }
    await batchSetSyncMeta(metaEntries);

    console.log(`[Sync] ✅ Database download completed in ${Date.now() - startTime}ms`);
  } catch (e) {
    // If we have a backup and the error occurred after closing DB, try to recover
    if (await adapter.fileExists(backupPath)) {
      try {
        console.log("[Sync] ⚠️ Error occurred, restoring from backup...");
        await adapter.copyFile(backupPath, dbPath);
        await adapter.reopenDatabase();
      } catch {
        // Recovery failed — DB may be in a bad state
      }
    }
    throw e;
  } finally {
    // Clean up temp files
    for (const file of [tempDbPath, backupPath]) {
      try {
        if (await adapter.fileExists(file)) {
          await adapter.deleteFile(file);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
