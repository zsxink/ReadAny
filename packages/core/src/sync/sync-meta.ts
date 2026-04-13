/**
 * Sync metadata operations — reading/writing sync_metadata table and sync mutex lock.
 */

import { getDB } from "../db/database";

// ─── Sync Mutex ────────────────────────────────────────────────────────────────

let syncInProgress: Promise<void> | null = null;

/**
 * Acquire sync lock — prevents concurrent sync operations.
 * Returns a function to release the lock when done.
 */
export async function acquireSyncLock(): Promise<() => void> {
  if (syncInProgress) {
    console.log("[Sync] ⏳ Another sync is in progress, waiting...");
    await syncInProgress;
  }

  let release: () => void = () => {};
  syncInProgress = new Promise<void>((resolve) => {
    release = resolve;
  });

  console.log("[Sync] 🔒 Sync lock acquired");
  return () => {
    console.log("[Sync] 🔓 Sync lock released");
    syncInProgress = null;
    release();
  };
}

/** Get a sync metadata value from the database */
export async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>("SELECT value FROM sync_metadata WHERE key = ?", [
    key,
  ]);
  return rows[0]?.value ?? null;
}

/**
 * Set sync metadata values.
 *
 * Keep this intentionally transaction-free: some platform adapters can lose
 * the explicit transaction state across await boundaries, which makes a later
 * COMMIT fail with "no transaction is active". These writes are tiny and safe
 * to apply sequentially.
 */
export async function batchSetSyncMeta(entries: [string, string][]): Promise<void> {
  const db = await getDB();
  for (const [key, value] of entries) {
    await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
      key,
      value,
    ]);
  }
}
