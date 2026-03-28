/**
 * Simplified sync service inspired by OpenReadest's approach.
 *
 * Core idea:
 * 1. Use updated_at timestamp to track changes
 * 2. Pull changes since lastSyncedAt
 * 3. Push local changes
 * 4. Separate data types: books, highlights, notes, bookmarks
 * 5. Soft delete with deleted_at field
 */

import { getDB } from "../db/database";
import type { ISyncBackend } from "./sync-backend";

// Tables to sync with their timestamp column
const SYNC_TABLES = [
  { name: "books", pk: "id", timestampCol: "updated_at" },
  { name: "highlights", pk: "id", timestampCol: "updated_at" },
  { name: "notes", pk: "id", timestampCol: "updated_at" },
  { name: "bookmarks", pk: "id", timestampCol: "updated_at" },
] as const;

// Path for sync data
// NOTE: We sync JSON data, NOT the entire db file
// This is much smaller (usually <1MB vs potentially 100MB+ for db with chunks)
const SYNC_DATA_PATH = "/readany/sync";
const SYNC_FILE = `${SYNC_DATA_PATH}/data.json`;

export interface SyncPayload {
  deviceId: string;
  timestamp: number;
  tables: {
    [tableName: string]: {
      records: Record<string, unknown>[];
      deletedIds: string[];
    };
  };
}

/**
 * Get device ID or create one
 */
async function getDeviceId(): Promise<string> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'device_id'",
  );
  if (rows[0]?.value) return rows[0].value;

  const deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('device_id', ?)", [
    deviceId,
  ]);
  return deviceId;
}

/**
 * Get last sync timestamp
 */
async function getLastSyncTimestamp(): Promise<number> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'last_sync_at'",
  );
  return rows[0]?.value ? Number.parseInt(rows[0].value, 10) : 0;
}

/**
 * Set last sync timestamp
 */
async function setLastSyncTimestamp(timestamp: number): Promise<void> {
  const db = await getDB();
  await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_sync_at', ?)", [
    String(timestamp),
  ]);
}

/**
 * Collect local changes since given timestamp
 */
export async function collectChanges(since: number): Promise<SyncPayload> {
  const db = await getDB();
  const deviceId = await getDeviceId();
  const now = Date.now();
  const payload: SyncPayload = {
    deviceId,
    timestamp: now,
    tables: {},
  };

  for (const { name, timestampCol } of SYNC_TABLES) {
    // Get updated records
    const records = await db.select<Record<string, unknown>>(
      `SELECT * FROM ${name} WHERE ${timestampCol} > ?`,
      [since],
    );

    // Get deleted records (from tombstones)
    let deletedIds: string[] = [];
    try {
      const tombstones = await db.select<{ id: string }>(
        "SELECT id FROM sync_tombstones WHERE table_name = ? AND deleted_at > ?",
        [name, since],
      );
      deletedIds = tombstones.map((t) => t.id);
    } catch {
      // Table might not exist
    }

    if (records.length > 0 || deletedIds.length > 0) {
      payload.tables[name] = { records, deletedIds };
    }
  }

  return payload;
}

/**
 * Apply remote changes to local database
 */
export async function applyChanges(
  payload: SyncPayload,
): Promise<{ applied: number; conflicts: number }> {
  const db = await getDB();
  let applied = 0;
  let conflicts = 0;

  await db.execute("BEGIN TRANSACTION");

  try {
    for (const [tableName, tableData] of Object.entries(payload.tables)) {
      const tableInfo = SYNC_TABLES.find((t) => t.name === tableName);
      if (!tableInfo) continue;

      const { pk, timestampCol } = tableInfo;

      // Apply records
      for (const record of tableData.records) {
        const pkValue = record[pk];
        const remoteTimestamp = record[timestampCol] as number;

        // Check if local record exists
        const existing = await db.select<Record<string, unknown>>(
          `SELECT ${timestampCol} FROM ${tableName} WHERE ${pk} = ?`,
          [pkValue],
        );

        if (existing.length > 0) {
          const localTimestamp = existing[0][timestampCol] as number;
          // Only apply if remote is newer
          if (remoteTimestamp > localTimestamp) {
            await upsertRecord(db, tableName, record, pk);
            applied++;
          } else {
            conflicts++;
          }
        } else {
          // New record, insert it
          await upsertRecord(db, tableName, record, pk);
          applied++;
        }
      }

      // Apply deletions
      for (const deletedId of tableData.deletedIds) {
        await db.execute(`DELETE FROM ${tableName} WHERE ${pk} = ?`, [deletedId]);
        applied++;
      }
    }

    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }

  return { applied, conflicts };
}

/**
 * Upsert a record into a table
 */
async function upsertRecord(
  db: Awaited<ReturnType<typeof getDB>>,
  table: string,
  record: Record<string, unknown>,
  pk: string,
): Promise<void> {
  const columns = Object.keys(record);
  const values = Object.values(record);
  const placeholders = columns.map(() => "?").join(", ");
  const updateSet = columns
    .filter((c) => c !== pk)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  const sql = `
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${pk}) DO UPDATE SET ${updateSet}
  `;

  await db.execute(sql, values);
}

/**
 * Upload sync payload to backend
 */
async function uploadPayload(backend: ISyncBackend, payload: SyncPayload): Promise<void> {
  await backend.putJSON(SYNC_FILE, payload);
}

/**
 * Download sync payload from backend
 */
async function downloadPayload(backend: ISyncBackend): Promise<SyncPayload | null> {
  return backend.getJSON<SyncPayload>(SYNC_FILE);
}

/**
 * Run sync: pull remote changes, then push local changes
 */
export async function runSimpleSync(
  backend: ISyncBackend,
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; changes: number; error?: string }> {
  try {
    onProgress?.("准备同步...");
    console.log("[SimpleSync] Starting sync...");

    // 1. Get last sync timestamp
    const lastSync = await getLastSyncTimestamp();
    console.log(`[SimpleSync] Last sync: ${new Date(lastSync).toISOString()}`);

    // 2. Pull remote changes
    onProgress?.("获取远程变更...");
    console.log("[SimpleSync] Downloading remote payload...");
    const remotePayload = await downloadPayload(backend);
    console.log("[SimpleSync] Remote payload downloaded:", remotePayload ? "yes" : "no");

    if (remotePayload) {
      console.log(
        `[SimpleSync] Remote changes: ${Object.keys(remotePayload.tables).length} tables`,
      );

      // Don't apply our own changes
      const localDeviceId = await getDeviceId();
      console.log(`[SimpleSync] Local device ID: ${localDeviceId}`);
      console.log(`[SimpleSync] Remote device ID: ${remotePayload.deviceId}`);

      if (remotePayload.deviceId !== localDeviceId) {
        // Apply remote changes
        onProgress?.("应用远程变更...");
        console.log("[SimpleSync] Applying remote changes...");
        const result = await applyChanges(remotePayload);
        console.log(
          `[SimpleSync] Applied ${result.applied} changes, ${result.conflicts} conflicts`,
        );
      } else {
        console.log("[SimpleSync] Skipping own changes");
      }
    }

    // 3. Collect and push local changes
    onProgress?.("收集本地变更...");
    console.log("[SimpleSync] Collecting local changes...");
    const localPayload = await collectChanges(lastSync);
    console.log("[SimpleSync] Local changes collected");

    const changeCount = Object.values(localPayload.tables).reduce(
      (sum, t) => sum + t.records.length + t.deletedIds.length,
      0,
    );
    console.log(`[SimpleSync] Change count: ${changeCount}`);

    if (changeCount > 0) {
      console.log(`[SimpleSync] Uploading ${changeCount} changes...`);
      onProgress?.(`上传 ${changeCount} 条变更...`);
      await uploadPayload(backend, localPayload);
      console.log("[SimpleSync] Upload complete");
    } else {
      console.log("[SimpleSync] No local changes to upload");
    }

    // 4. Update last sync timestamp
    console.log("[SimpleSync] Updating last sync timestamp...");
    await setLastSyncTimestamp(Date.now());

    onProgress?.("同步完成");
    console.log("[SimpleSync] Sync complete!");
    return { success: true, changes: changeCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[SimpleSync] Sync failed:", error);
    return { success: false, changes: 0, error };
  }
}
