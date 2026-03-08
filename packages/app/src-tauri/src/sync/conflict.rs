use rusqlite::Connection;

use super::error::SyncError;
use super::models::*;

/// Result of merging a remote changeset into local DB
pub struct MergeResult {
    pub records_applied: u32,
    pub records_merged: u32,
    pub conflicts_count: u32,
}

/// Merge a remote changeset into the local database
pub fn merge_changeset(
    conn: &Connection,
    changeset: &SyncChangeset,
    local_device_id: &str,
) -> Result<MergeResult, SyncError> {
    let mut result = MergeResult {
        records_applied: 0,
        records_merged: 0,
        conflicts_count: 0,
    };

    // Merge each table's records
    merge_table_records(
        conn,
        "books",
        &changeset.books,
        local_device_id,
        MergeStrategy::LastWriteWins,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "highlights",
        &changeset.highlights,
        local_device_id,
        MergeStrategy::UnionKeepBoth,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "notes",
        &changeset.notes,
        local_device_id,
        MergeStrategy::UnionKeepBoth,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "bookmarks",
        &changeset.bookmarks,
        local_device_id,
        MergeStrategy::UnionDedupe,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "threads",
        &changeset.threads,
        local_device_id,
        MergeStrategy::LastWriteWins,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "messages",
        &changeset.messages,
        local_device_id,
        MergeStrategy::AppendOnly,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "reading_sessions",
        &changeset.reading_sessions,
        local_device_id,
        MergeStrategy::AppendOnly,
        &mut result,
    )?;
    merge_table_records(
        conn,
        "skills",
        &changeset.skills,
        local_device_id,
        MergeStrategy::LastWriteWins,
        &mut result,
    )?;

    // Apply tombstones
    apply_tombstones(conn, &changeset.tombstones, local_device_id)?;

    Ok(result)
}

#[derive(Clone, Copy)]
enum MergeStrategy {
    LastWriteWins,
    UnionKeepBoth,
    UnionDedupe,
    AppendOnly,
}

/// Merge records from a remote device into a local table
fn merge_table_records(
    conn: &Connection,
    table: &str,
    records: &[SyncRecord],
    local_device_id: &str,
    strategy: MergeStrategy,
    result: &mut MergeResult,
) -> Result<(), SyncError> {
    for record in records {
        // Skip records that originated from our device (echo prevention)
        if record.last_modified_by == local_device_id {
            continue;
        }

        // Check if record exists locally
        let exists: bool = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {} WHERE id = ?1", table),
                [&record.id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)?;

        // Check if record is in tombstones
        let tombstone_time: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM sync_tombstones WHERE id = ?1 AND table_name = ?2",
                rusqlite::params![&record.id, table],
                |row| row.get(0),
            )
            .ok();

        if !exists {
            if let Some(deleted_at) = tombstone_time {
                // Was locally deleted — only restore if remote is newer
                if record.updated_at > deleted_at {
                    insert_record(conn, table, &record.data)?;
                    // Remove tombstone since we're restoring
                    conn.execute(
                        "DELETE FROM sync_tombstones WHERE id = ?1 AND table_name = ?2",
                        rusqlite::params![&record.id, table],
                    )?;
                    result.records_applied += 1;
                }
            } else {
                // Not locally present and not deleted — insert
                insert_record(conn, table, &record.data)?;
                result.records_applied += 1;
            }
        } else {
            // Record exists locally — merge based on strategy
            match strategy {
                MergeStrategy::LastWriteWins => {
                    let local_updated_at: i64 = conn
                        .query_row(
                            &format!(
                                "SELECT COALESCE(updated_at, created_at, 0) FROM {} WHERE id = ?1",
                                table
                            ),
                            [&record.id],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);

                    if record.updated_at > local_updated_at {
                        // Special handling for books: preserve local file_path and cover_url
                        if table == "books" {
                            update_book_record_preserving_local(conn, &record.data)?;
                        } else {
                            update_record(conn, table, &record.id, &record.data)?;
                        }
                        result.records_merged += 1;
                    }
                }
                MergeStrategy::UnionKeepBoth => {
                    let local_updated_at: i64 = conn
                        .query_row(
                            &format!("SELECT COALESCE(updated_at, 0) FROM {} WHERE id = ?1", table),
                            [&record.id],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);

                    if record.updated_at > local_updated_at {
                        // Remote is newer, update
                        update_record(conn, table, &record.id, &record.data)?;
                        result.records_merged += 1;
                    }
                    // If both modified, both versions are kept (local stays, remote is newer so updates)
                }
                MergeStrategy::UnionDedupe => {
                    // For bookmarks: already exists, skip (dedupe by id)
                }
                MergeStrategy::AppendOnly => {
                    // Already exists, skip (messages and reading_sessions are append-only)
                }
            }
        }
    }

    Ok(())
}

/// Apply remote tombstones — delete local records if appropriate
fn apply_tombstones(
    conn: &Connection,
    tombstones: &[Tombstone],
    local_device_id: &str,
) -> Result<(), SyncError> {
    for tombstone in tombstones {
        // Skip tombstones from our own device
        if tombstone.device_id == local_device_id {
            continue;
        }

        // Check local record's updated_at
        let local_updated_at: Option<i64> = conn
            .query_row(
                &format!(
                    "SELECT COALESCE(updated_at, created_at, 0) FROM {} WHERE id = ?1",
                    tombstone.table_name
                ),
                [&tombstone.id],
                |row| row.get(0),
            )
            .ok();

        if let Some(local_time) = local_updated_at {
            if local_time <= tombstone.deleted_at {
                // Local was not modified after deletion — delete locally
                conn.execute(
                    &format!("DELETE FROM {} WHERE id = ?1", tombstone.table_name),
                    [&tombstone.id],
                )?;
            }
            // If local was modified after remote deletion, keep local (local modification wins)
        }

        // Also store the tombstone locally for propagation
        conn.execute(
            "INSERT OR IGNORE INTO sync_tombstones (id, table_name, deleted_at, device_id) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                &tombstone.id,
                &tombstone.table_name,
                tombstone.deleted_at,
                &tombstone.device_id,
            ],
        )?;
    }
    Ok(())
}

/// Insert a record from JSON data into a table
fn insert_record(
    conn: &Connection,
    table: &str,
    data: &serde_json::Value,
) -> Result<(), SyncError> {
    let obj = data
        .as_object()
        .ok_or_else(|| SyncError::Other("Record data is not an object".into()))?;

    // Skip blob fields (embedding) and machine-specific fields for certain tables
    let skip_fields = if table == "books" {
        vec!["embedding"]
    } else if table == "chunks" {
        vec!["embedding"]
    } else {
        vec![]
    };

    let mut columns: Vec<String> = Vec::new();
    let mut placeholders: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    for (key, val) in obj {
        if skip_fields.contains(&key.as_str()) {
            continue;
        }
        columns.push(key.clone());
        placeholders.push(format!("?{}", idx));
        idx += 1;
        values.push(json_value_to_sql(val));
    }

    let sql = format!(
        "INSERT OR IGNORE INTO {} ({}) VALUES ({})",
        table,
        columns.join(", "),
        placeholders.join(", "),
    );

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Update a record from JSON data
fn update_record(
    conn: &Connection,
    table: &str,
    id: &str,
    data: &serde_json::Value,
) -> Result<(), SyncError> {
    let obj = data
        .as_object()
        .ok_or_else(|| SyncError::Other("Record data is not an object".into()))?;

    let skip_fields = vec!["id", "embedding"];

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    for (key, val) in obj {
        if skip_fields.contains(&key.as_str()) {
            continue;
        }
        sets.push(format!("{} = ?{}", key, idx));
        idx += 1;
        values.push(json_value_to_sql(val));
    }

    values.push(Box::new(id.to_string()));

    let sql = format!(
        "UPDATE {} SET {} WHERE id = ?{}",
        table,
        sets.join(", "),
        idx,
    );

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Update a book record while preserving machine-specific fields (file_path, cover_url)
fn update_book_record_preserving_local(
    conn: &Connection,
    data: &serde_json::Value,
) -> Result<(), SyncError> {
    let obj = data
        .as_object()
        .ok_or_else(|| SyncError::Other("Record data is not an object".into()))?;

    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SyncError::Other("Book record missing id".into()))?;

    // Fields to skip: machine-specific + embedding
    let skip_fields = vec!["id", "file_path", "cover_url", "embedding", "is_vectorized", "vectorize_progress"];

    // Special handling for progress: take the higher value
    let remote_progress = obj
        .get("progress")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let local_progress: f64 = conn
        .query_row("SELECT progress FROM books WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .unwrap_or(0.0);

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    for (key, val) in obj {
        if skip_fields.contains(&key.as_str()) {
            continue;
        }
        if key == "progress" {
            // Take the higher progress
            if remote_progress > local_progress {
                sets.push(format!("progress = ?{}", idx));
                idx += 1;
                values.push(Box::new(remote_progress));
                // Also update current_cfi to match the higher progress
                if let Some(cfi) = obj.get("current_cfi") {
                    sets.push(format!("current_cfi = ?{}", idx));
                    idx += 1;
                    values.push(json_value_to_sql(cfi));
                }
            }
            continue;
        }
        if key == "current_cfi" {
            // Handled with progress above
            if remote_progress > local_progress {
                continue; // Already added above
            }
            continue; // Skip if local progress is higher
        }
        sets.push(format!("{} = ?{}", key, idx));
        idx += 1;
        values.push(json_value_to_sql(val));
    }

    if sets.is_empty() {
        return Ok(());
    }

    values.push(Box::new(id.to_string()));

    let sql = format!("UPDATE books SET {} WHERE id = ?{}", sets.join(", "), idx);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Convert a serde_json::Value to a boxed ToSql parameter
fn json_value_to_sql(val: &serde_json::Value) -> Box<dyn rusqlite::types::ToSql> {
    match val {
        serde_json::Value::Null => Box::new(Option::<String>::None),
        serde_json::Value::Bool(b) => Box::new(if *b { 1i64 } else { 0i64 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        // For arrays and objects, serialize as JSON string
        _ => Box::new(val.to_string()),
    }
}
