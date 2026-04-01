/**
 * Sync engine — whole-database overwrite sync via multiple backends.
 * Supports WebDAV, S3, and LAN sync through ISyncBackend interface.
 */

import { ensureNoTransaction, getDB } from "../db/database";
import { getSyncAdapter } from "./sync-adapter";
import type { ISyncBackend } from "./sync-backend";
import {
  REMOTE_COVERS,
  REMOTE_DB_FILE,
  REMOTE_DELTA_FILE,
  REMOTE_FILES,
  REMOTE_MANIFEST,
  type RemoteSyncManifest,
  SYNC_META_KEYS,
  SYNC_SCHEMA_VERSION,
  type SyncDirection,
  type SyncResult,
} from "./sync-types";

/** Get a sync metadata value from the database */
async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>("SELECT value FROM sync_metadata WHERE key = ?", [
    key,
  ]);
  return rows[0]?.value ?? null;
}

/** Set multiple sync metadata values in a single transaction */
async function batchSetSyncMeta(entries: [string, string][]): Promise<void> {
  await ensureNoTransaction();
  const db = await getDB();
  let inTransaction = false;
  try {
    await db.execute("BEGIN TRANSACTION", []);
    inTransaction = true;
    for (const [key, value] of entries) {
      await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
        key,
        value,
      ]);
    }
    await db.execute("COMMIT", []);
    inTransaction = false;
  } catch (e) {
    if (inTransaction) {
      try {
        await db.execute("ROLLBACK", []);
      } catch {
        // Ignore rollback errors
      }
    }
    throw e;
  }
}

/**
 * Determine sync direction by comparing local and remote state.
 *
 * Logic:
 * - No remote manifest → "upload" (first sync)
 * - No local hash → "download" (first sync on this device, or after reset)
 * - Remote manifest.lastModifiedAt matches stored → "none" (no changes)
 * - Local hash changed AND remote unchanged → "upload"
 * - Remote changed AND local unchanged → "download"
 * - Both changed → "conflict" (user must pick)
 */
export async function determineSyncDirection(backend: ISyncBackend): Promise<{
  direction: SyncDirection;
  remoteManifest: RemoteSyncManifest | null;
}> {
  const adapter = getSyncAdapter();

  // Get remote manifest
  const remoteManifest = await backend.getJSON<RemoteSyncManifest>(REMOTE_MANIFEST);

  // Check schema version compatibility
  if (remoteManifest && remoteManifest.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error(
      `Remote sync schema version (${remoteManifest.schemaVersion}) is newer than local (${SYNC_SCHEMA_VERSION}). Please update the app.`,
    );
  }

  // No remote data → first sync, upload
  if (!remoteManifest) {
    return { direction: "upload", remoteManifest: null };
  }

  // Get local state
  const storedRemoteModifiedAt = await getSyncMeta(SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT);
  const storedDbHash = await getSyncMeta(SYNC_META_KEYS.LAST_SYNC_DB_HASH);
  const storedLastSyncAt = await getSyncMeta(SYNC_META_KEYS.LAST_SYNC_AT);

  // No local sync history → first sync on this device, download
  if (!storedDbHash) {
    return { direction: "download", remoteManifest };
  }

  // Check if remote changed
  const remoteChanged = storedRemoteModifiedAt !== String(remoteManifest.lastModifiedAt);

  // For incremental sync, also check lastSyncAt if available
  const remoteLastSyncAt = (remoteManifest as { lastSyncAt?: number }).lastSyncAt;
  const remoteSyncChanged =
    remoteLastSyncAt && storedLastSyncAt && String(remoteLastSyncAt) !== storedLastSyncAt;

  // Check if local DB changed (compare current hash with stored hash)
  const dbPath = await adapter.getDatabasePath();
  const currentDbHash = await adapter.hashFile(dbPath);
  const localChanged = currentDbHash !== storedDbHash;

  if (!remoteChanged && !remoteSyncChanged && !localChanged) {
    return { direction: "none", remoteManifest };
  }
  if (localChanged && !remoteChanged && !remoteSyncChanged) {
    return { direction: "upload", remoteManifest };
  }
  if ((remoteChanged || remoteSyncChanged) && !localChanged) {
    return { direction: "download", remoteManifest };
  }
  // Both changed
  return { direction: "conflict", remoteManifest };
}

/**
 * Execute the upload phase: snapshot local DB → upload to backend.
 */
async function executeUpload(
  backend: ISyncBackend,
  onProgress?: (progress: import("./sync-types").SyncProgress) => void,
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
    // This ensures other devices can use incremental sync after first full download
    try {
      const { collectLocalChanges, getDeviceId } = await import("./incremental-sync");
      const deviceId = await getDeviceId();
      const delta = await collectLocalChanges(0); // Get all records
      if (delta) {
        await backend.putJSON(REMOTE_DELTA_FILE, delta);
        console.log("[Sync] ✓ Delta file uploaded for incremental sync support");
      }

      // 5. Upload manifest with lastSyncAt for incremental sync compatibility
      const now = Date.now();
      const manifest = {
        lastModifiedAt: now,
        lastSyncAt: now, // Important for incremental sync direction detection
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
async function executeDownload(
  backend: ISyncBackend,
  remoteManifest: RemoteSyncManifest | null,
  onProgress?: (progress: import("./sync-types").SyncProgress) => void,
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

    // 7. Verify reopened DB works
    const db = await getDB();
    await db.select<unknown[]>("SELECT COUNT(*) as c FROM books", []);

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

/**
 * Helper: Run tasks in parallel with concurrency limit
 */
async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
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
 * Sync book files and covers between local and remote.
 * Files are downloaded in parallel (up to 8 concurrent downloads) for better performance.
 */
export async function syncFiles(
  backend: ISyncBackend,
  onProgress?: (progress: import("./sync-types").SyncProgress) => void,
): Promise<{
  filesUploaded: number;
  filesDownloaded: number;
}> {
  const syncFilesStart = Date.now();
  console.log("[Sync] 📁 Starting file sync...");

  const adapter = getSyncAdapter();
  const db = await getDB();
  let filesUploaded = 0;
  let filesDownloaded = 0;

  // Get all books from DB
  const books = await db.select<{
    id: string;
    file_path: string;
    file_hash: string;
    cover_url: string;
    title: string;
  }>("SELECT id, file_path, file_hash, cover_url, title FROM books", []);

  const appDataDir = await adapter.getAppDataDir();

  // --- Pre-compute all local paths and remote names ---
  type BookFileInfo = {
    book: { id: string; file_path: string; file_hash: string; cover_url: string; title: string };
    localPath: string;
    remoteName: string;
    ext: string;
  };
  type CoverFileInfo = {
    book: { id: string; cover_url: string; title: string };
    coverLocalPath: string;
    coverRemoteName: string;
  };

  const bookFileInfos: BookFileInfo[] = [];
  for (const book of books) {
    if (!book.file_path) continue;
    const localPath =
      book.file_path.startsWith("/") || book.file_path.startsWith("file://")
        ? book.file_path
        : adapter.joinPath(appDataDir, book.file_path);
    const ext = book.file_path.split(".").pop() || "epub";
    const remoteName = `${book.id}.${ext}`;
    bookFileInfos.push({ book, localPath, remoteName, ext });
  }

  const coverFileInfos: CoverFileInfo[] = [];
  for (const book of books) {
    if (!book.cover_url) continue;
    const coverLocalPath =
      book.cover_url.startsWith("/") || book.cover_url.startsWith("file://")
        ? book.cover_url
        : adapter.joinPath(appDataDir, book.cover_url);
    const coverExt = book.cover_url.split(".").pop() || "jpg";
    const coverRemoteName = `${book.id}.${coverExt}`;
    coverFileInfos.push({ book, coverLocalPath, coverRemoteName });
  }

  // --- Batch check all local file existence in parallel ---
  const allLocalPaths = [
    ...bookFileInfos.map((info) => info.localPath),
    ...coverFileInfos.map((info) => info.coverLocalPath),
  ];
  const existsResults = await Promise.all(allLocalPaths.map((p) => adapter.fileExists(p)));
  const localExistsMap = new Map<string, boolean>();
  allLocalPaths.forEach((p, i) => localExistsMap.set(p, existsResults[i]));

  // --- Fetch remote file/cover listings in parallel ---
  const [remoteFiles, remoteCovers] = await Promise.all([
    backend.listDir(REMOTE_FILES),
    backend.listDir(REMOTE_COVERS),
  ]);
  const remoteFileNames = new Set(remoteFiles.filter((f) => !f.isDirectory).map((f) => f.name));
  const remoteCoverNames = new Set(remoteCovers.filter((f) => !f.isDirectory).map((f) => f.name));

  // Collect upload and download tasks
  const uploadTasks: (() => Promise<boolean>)[] = [];
  const downloadTasks: (() => Promise<boolean>)[] = [];

  // --- Build book file tasks ---
  for (const { book, localPath, remoteName } of bookFileInfos) {
    const localExists = localExistsMap.get(localPath) ?? false;

    // Upload if not on remote and exists locally
    if (!remoteFileNames.has(remoteName) && localExists) {
      uploadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📤 Uploading book: ${bookTitle} (${remoteName})`);
          const data = await adapter.readFileBytes(localPath);
          const sizeMB = (data.length / 1024 / 1024).toFixed(2);
          await backend.put(`${REMOTE_FILES}/${remoteName}`, data);
          console.log(
            `[Sync] ✓ Uploaded "${bookTitle}" (${sizeMB} MB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to upload "${bookTitle}": ${e}`);
          return false;
        }
      });
    }

    // Mark as remote if not local but exists on remote (on-demand download)
    // This saves bandwidth for first-time sync with many books
  }

  // Mark books with remote files as "remote" status for on-demand download
  for (const { book, remoteName } of bookFileInfos) {
    const localPath = bookFileInfos.find((info) => info.book.id === book.id)?.localPath;
    const localExists = localPath ? (localExistsMap.get(localPath) ?? false) : false;

    if (!localExists && remoteFileNames.has(remoteName)) {
      try {
        const { updateBook } = await import("../db/database");
        await updateBook(book.id, { syncStatus: "remote" });
        const bookTitle = book.title || "未知书籍";
        console.log(`[Sync] Marked "${bookTitle}" as remote (on-demand download)`);
      } catch (e) {
        console.warn(`[Sync] Failed to mark book as remote: ${e}`);
      }
    }
  }

  // --- Build cover tasks ---
  for (const { book, coverLocalPath, coverRemoteName } of coverFileInfos) {
    const localExists = localExistsMap.get(coverLocalPath) ?? false;

    // Upload cover if not on remote
    if (!remoteCoverNames.has(coverRemoteName) && localExists) {
      uploadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📤 Uploading cover: ${bookTitle} (${coverRemoteName})`);
          const data = await adapter.readFileBytes(coverLocalPath);
          const sizeKB = (data.length / 1024).toFixed(2);
          await backend.put(`${REMOTE_COVERS}/${coverRemoteName}`, data);
          console.log(
            `[Sync] ✓ Uploaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to upload cover "${bookTitle}": ${e}`);
          return false;
        }
      });
    }

    // Download cover if not local
    if (!localExists && remoteCoverNames.has(coverRemoteName)) {
      downloadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📥 Downloading cover: ${bookTitle} (${coverRemoteName})`);
          const data = await backend.get(`${REMOTE_COVERS}/${coverRemoteName}`);
          const sizeKB = (data.length / 1024).toFixed(2);
          const dir = coverLocalPath.substring(0, coverLocalPath.lastIndexOf("/"));
          if (dir) await adapter.ensureDir(dir);
          await adapter.writeFileBytes(coverLocalPath, data);
          console.log(
            `[Sync] ✓ Downloaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to download cover "${bookTitle}": ${e}`);
          return false;
        }
      });
    }
  }

  // Execute uploads in parallel (limit: 5 concurrent)
  if (uploadTasks.length > 0) {
    console.log(`[Sync] 📤 Starting upload of ${uploadTasks.length} files (5 concurrent)...`);
    const uploadStart = Date.now();
    let completed = 0;
    const total = uploadTasks.length;
    const tasksWithProgress = uploadTasks.map((task, index) => async () => {
      onProgress?.({
        phase: "files",
        operation: "upload",
        currentFile: `File ${index + 1}`,
        completedFiles: completed,
        totalFiles: total,
        message: `Uploading file ${completed + 1}/${total}...`,
      });
      const result = await task();
      completed++;
      return result;
    });
    const uploadResults = await parallelLimit(tasksWithProgress, 5);
    filesUploaded = uploadResults.filter((r) => r).length;
    const uploadFailed = uploadResults.length - filesUploaded;
    console.log(
      `[Sync] ✅ Upload completed: ${filesUploaded} succeeded, ${uploadFailed} failed in ${Date.now() - uploadStart}ms`,
    );
  }

  // Execute downloads in parallel (limit: 8 concurrent)
  if (downloadTasks.length > 0) {
    console.log(`[Sync] 📥 Starting download of ${downloadTasks.length} files (8 concurrent)...`);
    const downloadStart = Date.now();
    let completed = 0;
    const total = downloadTasks.length;
    const tasksWithProgress = downloadTasks.map((task, index) => async () => {
      onProgress?.({
        phase: "files",
        operation: "download",
        currentFile: `File ${index + 1}`,
        completedFiles: completed,
        totalFiles: total,
        message: `Downloading file ${completed + 1}/${total}...`,
      });
      const result = await task();
      completed++;
      return result;
    });
    const downloadResults = await parallelLimit(tasksWithProgress, 8);
    filesDownloaded = downloadResults.filter((r) => r).length;
    const downloadFailed = downloadResults.length - filesDownloaded;
    console.log(
      `[Sync] ✅ Download completed: ${filesDownloaded} succeeded, ${downloadFailed} failed in ${Date.now() - downloadStart}ms`,
    );
  }

  console.log(`[Sync] ✅ File sync completed in ${Date.now() - syncFilesStart}ms`);
  return { filesUploaded, filesDownloaded };
}

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
  onProgress?: (progress: import("./sync-types").SyncProgress) => void,
  remoteManifest?: RemoteSyncManifest | null,
  onDatabaseReplaced?: () => Promise<void>,
  useIncremental?: boolean,
): Promise<SyncResult> {
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
      // This ensures the complete database is uploaded for other devices to download
      if (direction === "upload" && lastSync === 0) {
        console.log("[Sync] First sync, using full upload");
        await executeUpload(backend, onProgress);
        const { filesUploaded, filesDownloaded } = await syncFiles(backend, onProgress);
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

      const { filesUploaded, filesDownloaded } = await syncFiles(backend, onProgress);

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

    const { filesUploaded, filesDownloaded } = await syncFiles(backend, onProgress);

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
  }
}

/**
 * Download a single book file on-demand.
 * Used when user opens a book marked as "remote".
 */
export async function downloadBookFile(
  backend: ISyncBackend,
  bookId: string,
  filePath: string,
  onProgress?: (progress: { downloaded: number; total: number }) => void,
): Promise<boolean> {
  const adapter = getSyncAdapter();
  const { updateBook } = await import("../db/database");

  try {
    // Determine remote name
    const ext = filePath.split(".").pop() || "epub";
    const remoteName = `${bookId}.${ext}`;

    // Check if file exists on remote
    const remotePath = `${REMOTE_FILES}/${remoteName}`;
    const exists = await backend.exists(remotePath);
    if (!exists) {
      console.log(`[Sync] Book file not found on remote: ${remotePath}`);
      await updateBook(bookId, { syncStatus: "remote" });
      return false;
    }

    // Download file
    console.log(`[Sync] Downloading book file: ${remoteName}`);
    onProgress?.({ downloaded: 0, total: 100 });

    const data = await backend.get(remotePath);
    const sizeMB = (data.length / 1024 / 1024).toFixed(2);
    console.log(`[Sync] Downloaded ${remoteName} (${sizeMB} MB)`);

    // Save to local
    const appDataDir = await adapter.getAppDataDir();
    const localPath =
      filePath.startsWith("/") || filePath.startsWith("file://")
        ? filePath
        : adapter.joinPath(appDataDir, filePath);

    const dir = localPath.substring(0, localPath.lastIndexOf("/"));
    if (dir) await adapter.ensureDir(dir);
    await adapter.writeFileBytes(localPath, data);

    onProgress?.({ downloaded: 100, total: 100 });

    // Update book sync status
    await updateBook(bookId, { syncStatus: "local" });

    console.log(`[Sync] ✓ Book ${bookId} downloaded and marked as local`);
    return true;
  } catch (e) {
    console.error(`[Sync] Failed to download book ${bookId}:`, e);
    await updateBook(bookId, { syncStatus: "remote" });
    return false;
  }
}
