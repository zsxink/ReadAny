use rusqlite::Connection;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use super::conflict;
use super::error::SyncError;
use super::file_sync::FileSyncEngine;
use super::models::*;
use super::webdav::WebDavClient;

/// Remote path constants
const REMOTE_ROOT: &str = "/readany";
const REMOTE_SYNC: &str = "/readany/sync";
const REMOTE_CHANGESETS: &str = "/readany/sync/changesets";
const REMOTE_MANIFEST: &str = "/readany/sync/manifest.json";
const REMOTE_FILES_BOOKS: &str = "/readany/files/books";
const REMOTE_FILES_COVERS: &str = "/readany/files/covers";

/// Global flag to prevent concurrent syncs
static IS_SYNCING: AtomicBool = AtomicBool::new(false);

/// Execute a full sync cycle. This is the top-level entry point.
/// All DB operations are done synchronously (no Connection held across await).
pub async fn run_sync(
    client: WebDavClient,
    db_path: String,
    app_data_dir: String,
    device_id: String,
    device_name: String,
) -> Result<SyncResult, SyncError> {
    // Prevent concurrent syncs
    if IS_SYNCING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(SyncError::AlreadySyncing);
    }

    let start = Instant::now();
    let result = do_sync(&client, &db_path, &app_data_dir, &device_id, &device_name).await;
    IS_SYNCING.store(false, Ordering::SeqCst);

    match result {
        Ok(mut r) => {
            r.duration_ms = start.elapsed().as_millis() as u64;
            Ok(r)
        }
        Err(e) => {
            let mut r = SyncResult::default();
            r.success = false;
            r.error = Some(e.to_string());
            r.duration_ms = start.elapsed().as_millis() as u64;
            Ok(r)
        }
    }
}

async fn do_sync(
    client: &WebDavClient,
    db_path: &str,
    app_data_dir: &str,
    device_id: &str,
    device_name: &str,
) -> Result<SyncResult, SyncError> {
    let mut result = SyncResult::default();

    // Step 1: Verify connection
    client.test_connection().await?;

    // Step 2: Ensure remote directory structure
    client.ensure_directory(REMOTE_ROOT).await?;
    client.ensure_directory(REMOTE_SYNC).await?;
    client.ensure_directory(REMOTE_CHANGESETS).await?;
    client.ensure_directory(REMOTE_FILES_BOOKS).await?;
    client.ensure_directory(REMOTE_FILES_COVERS).await?;

    // Step 3: Read local sync state (synchronous DB access, no await after)
    let (_last_sync_at, _last_sync_version, known_device_versions, local_changeset) = {
        let conn = Connection::open(db_path)?;
        let last_sync_at = get_sync_meta(&conn, "last_sync_at")
            .unwrap_or_default()
            .parse::<i64>()
            .unwrap_or(0);
        let last_sync_version = get_sync_meta(&conn, "last_sync_version")
            .unwrap_or_default()
            .parse::<i64>()
            .unwrap_or(0);
        let known_device_versions: HashMap<String, i64> =
            get_sync_meta(&conn, "known_device_versions")
                .and_then(|kv| serde_json::from_str(&kv).ok())
                .unwrap_or_default();

        // Build local changeset
        let local_changeset = build_local_changeset(
            &conn,
            device_id,
            device_name,
            last_sync_version,
            last_sync_at,
        )?;

        (last_sync_at, last_sync_version, known_device_versions, local_changeset)
    }; // conn dropped here, before any await

    result.records_uploaded = local_changeset.books.len() as u32
        + local_changeset.highlights.len() as u32
        + local_changeset.notes.len() as u32
        + local_changeset.bookmarks.len() as u32
        + local_changeset.threads.len() as u32
        + local_changeset.messages.len() as u32
        + local_changeset.reading_sessions.len() as u32
        + local_changeset.skills.len() as u32;

    // Step 4: Download remote manifest (async)
    let remote_manifest: Option<SyncManifest> = client
        .get_json_optional(REMOTE_MANIFEST)
        .await?;

    // Check schema version compatibility
    if let Some(ref manifest) = remote_manifest {
        if manifest.schema_version > SCHEMA_VERSION {
            return Err(SyncError::SchemaVersionMismatch {
                remote: manifest.schema_version,
                local: SCHEMA_VERSION,
            });
        }
    }

    // Step 5: Download remote changesets (async)
    let remote_resources = client.propfind(REMOTE_CHANGESETS).await?;
    let mut remote_changesets: Vec<SyncChangeset> = Vec::new();
    let mut updated_known_versions = known_device_versions.clone();

    for resource in &remote_resources {
        if resource.is_collection {
            continue;
        }
        let filename = super::webdav::filename_from_href(&resource.href);
        if !filename.ends_with(".json") {
            continue;
        }
        let remote_device_id = filename.trim_end_matches(".json");
        if remote_device_id == device_id {
            continue;
        }

        let changeset_path = format!("{}/{}", REMOTE_CHANGESETS, filename);
        match client.get_json::<SyncChangeset>(&changeset_path).await {
            Ok(changeset) => {
                let known_version =
                    known_device_versions.get(remote_device_id).copied().unwrap_or(0);
                if changeset.to_version > known_version {
                    updated_known_versions
                        .insert(remote_device_id.to_string(), changeset.to_version);
                    remote_changesets.push(changeset);
                }
            }
            Err(e) => {
                eprintln!(
                    "Warning: Failed to download changeset from {}: {}",
                    remote_device_id, e
                );
            }
        }
    }

    // Step 6: Merge remote changes into local DB (synchronous)
    {
        let conn = Connection::open(db_path)?;
        for remote_changeset in &remote_changesets {
            let merge_result =
                conflict::merge_changeset(&conn, remote_changeset, device_id)?;
            result.records_downloaded += merge_result.records_applied;
            result.records_merged += merge_result.records_merged;
            result.conflicts_count += merge_result.conflicts_count;
        }
    } // conn dropped before next await

    // Step 7: Upload local changeset (async)
    if result.records_uploaded > 0 || !local_changeset.tombstones.is_empty() {
        let changeset_path = format!("{}/{}.json", REMOTE_CHANGESETS, device_id);
        client.put_json(&changeset_path, &local_changeset).await?;
    }

    // Step 8: Update remote manifest (async)
    let new_manifest = SyncManifest {
        devices: build_device_list(
            remote_manifest.as_ref(),
            device_id,
            device_name,
            local_changeset.to_version,
        ),
        schema_version: SCHEMA_VERSION,
        updated_at: now_millis(),
    };
    client.put_json(REMOTE_MANIFEST, &new_manifest).await?;

    // Step 9: File sync (manages its own Connection/async split internally)
    {
        let file_engine = FileSyncEngine::new(client, app_data_dir);
        let file_result = file_engine.sync_files(db_path).await?;
        result.files_uploaded = file_result.files_uploaded;
        result.files_downloaded = file_result.files_downloaded;
    }

    // Step 10: Update local sync metadata (synchronous)
    {
        let conn = Connection::open(db_path)?;
        let new_sync_version = local_changeset.to_version;
        set_sync_meta(&conn, "last_sync_at", &now_millis().to_string())?;
        set_sync_meta(&conn, "last_sync_version", &new_sync_version.to_string())?;
        set_sync_meta(
            &conn,
            "known_device_versions",
            &serde_json::to_string(&updated_known_versions)?,
        )?;

        // Clean up old tombstones (older than 90 days)
        let cutoff = now_millis() - 90 * 24 * 60 * 60 * 1000;
        conn.execute("DELETE FROM sync_tombstones WHERE deleted_at < ?1", [cutoff])?;
    }

    Ok(result)
}

/// Build local changeset: all records modified since last sync
fn build_local_changeset(
    conn: &Connection,
    device_id: &str,
    device_name: &str,
    last_sync_version: i64,
    last_sync_at: i64,
) -> Result<SyncChangeset, SyncError> {
    let current_max_version = get_max_sync_version(conn)?;

    let books = query_changed_records(conn, "books", device_id, last_sync_version)?;
    let highlights = query_changed_records(conn, "highlights", device_id, last_sync_version)?;
    let notes = query_changed_records(conn, "notes", device_id, last_sync_version)?;
    let bookmarks = query_changed_records(conn, "bookmarks", device_id, last_sync_version)?;
    let threads = query_changed_records(conn, "threads", device_id, last_sync_version)?;
    let messages = query_changed_records(conn, "messages", device_id, last_sync_version)?;
    let reading_sessions =
        query_changed_records(conn, "reading_sessions", device_id, last_sync_version)?;
    let skills = query_changed_records(conn, "skills", device_id, last_sync_version)?;

    let tombstones = query_tombstones(conn, last_sync_at)?;

    Ok(SyncChangeset {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        timestamp: now_millis(),
        from_version: last_sync_version,
        to_version: current_max_version,
        schema_version: SCHEMA_VERSION,
        books,
        highlights,
        notes,
        bookmarks,
        threads,
        messages,
        reading_sessions,
        skills,
        tombstones,
    })
}

/// Query records that have changed since last_sync_version for the local device
fn query_changed_records(
    conn: &Connection,
    table: &str,
    device_id: &str,
    last_sync_version: i64,
) -> Result<Vec<SyncRecord>, SyncError> {
    let columns = get_table_columns(conn, table)?;

    let sql = format!(
        "SELECT * FROM {} WHERE sync_version > ?1 AND (last_modified_by = ?2 OR last_modified_by IS NULL)",
        table
    );
    let mut stmt = conn.prepare(&sql)?;
    let column_count = stmt.column_count();

    let mut records: Vec<SyncRecord> = Vec::new();
    let mut rows = stmt.query(rusqlite::params![last_sync_version, device_id])?;

    while let Some(row) = rows.next()? {
        let mut map = serde_json::Map::new();
        for i in 0..column_count {
            let col_name = columns.get(i).cloned().unwrap_or_default();
            let value: serde_json::Value = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
                Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                Ok(rusqlite::types::ValueRef::Text(s)) => {
                    json!(String::from_utf8_lossy(s).to_string())
                }
                Ok(rusqlite::types::ValueRef::Blob(_)) => serde_json::Value::Null,
                Err(_) => serde_json::Value::Null,
            };
            map.insert(col_name, value);
        }

        let id = map
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = map
            .get("updated_at")
            .and_then(|v| v.as_i64())
            .or_else(|| map.get("created_at").and_then(|v| v.as_i64()))
            .unwrap_or(0);
        let sync_version = map
            .get("sync_version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let last_modified_by = map
            .get("last_modified_by")
            .and_then(|v| v.as_str())
            .unwrap_or(device_id)
            .to_string();

        records.push(SyncRecord {
            id,
            data: serde_json::Value::Object(map),
            updated_at,
            sync_version,
            last_modified_by,
        });
    }

    Ok(records)
}

/// Get column names for a table
fn get_table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, SyncError> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&sql)?;
    let mut columns = Vec::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        columns.push(name);
    }
    Ok(columns)
}

/// Query tombstones since last sync
fn query_tombstones(conn: &Connection, last_sync_at: i64) -> Result<Vec<Tombstone>, SyncError> {
    let mut stmt = conn.prepare(
        "SELECT id, table_name, deleted_at, device_id FROM sync_tombstones WHERE deleted_at > ?1",
    )?;
    let mut tombstones = Vec::new();
    let mut rows = stmt.query([last_sync_at])?;
    while let Some(row) = rows.next()? {
        tombstones.push(Tombstone {
            id: row.get(0)?,
            table_name: row.get(1)?,
            deleted_at: row.get(2)?,
            device_id: row.get(3)?,
        });
    }
    Ok(tombstones)
}

/// Get the maximum sync_version across all tables
fn get_max_sync_version(conn: &Connection) -> Result<i64, SyncError> {
    let mut max: i64 = 0;
    for table in SYNCED_TABLES {
        let sql = format!("SELECT COALESCE(MAX(sync_version), 0) FROM {}", table);
        let v: i64 = conn.query_row(&sql, [], |row| row.get(0))?;
        if v > max {
            max = v;
        }
    }
    Ok(max)
}

/// Get a sync metadata value
pub fn get_sync_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM sync_metadata WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

/// Set a sync metadata value
pub fn set_sync_meta(conn: &Connection, key: &str, value: &str) -> Result<(), SyncError> {
    conn.execute(
        "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Get or generate device ID
pub fn get_or_create_device_id(conn: &Connection) -> Result<String, SyncError> {
    if let Some(id) = get_sync_meta(conn, "device_id") {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    set_sync_meta(conn, "device_id", &id)?;
    Ok(id)
}

/// Build device list for manifest
fn build_device_list(
    existing: Option<&SyncManifest>,
    device_id: &str,
    device_name: &str,
    sync_version: i64,
) -> Vec<DeviceInfo> {
    let mut devices: Vec<DeviceInfo> = existing
        .map(|m| m.devices.clone())
        .unwrap_or_default();

    let current = DeviceInfo {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        last_sync_at: now_millis(),
        sync_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    if let Some(pos) = devices.iter().position(|d| d.device_id == device_id) {
        devices[pos] = current;
    } else {
        devices.push(current);
    }

    devices
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
