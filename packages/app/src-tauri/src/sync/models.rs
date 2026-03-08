use serde::{Deserialize, Serialize};

/// Current schema version for sync compatibility checks
pub const SCHEMA_VERSION: i32 = 7;

/// WebDAV sync configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub auto_sync: bool,
    pub sync_interval_mins: u32,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            username: String::new(),
            password: String::new(),
            auto_sync: false,
            sync_interval_mins: 30,
        }
    }
}

/// Manifest stored on the remote, tracks global sync state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub devices: Vec<DeviceInfo>,
    pub schema_version: i32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub last_sync_at: i64,
    pub sync_version: i64,
    pub app_version: String,
}

/// A changeset uploaded by a device — contains all changes since last sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncChangeset {
    pub device_id: String,
    pub device_name: String,
    pub timestamp: i64,
    pub from_version: i64,
    pub to_version: i64,
    pub schema_version: i32,
    pub books: Vec<SyncRecord>,
    pub highlights: Vec<SyncRecord>,
    pub notes: Vec<SyncRecord>,
    pub bookmarks: Vec<SyncRecord>,
    pub threads: Vec<SyncRecord>,
    pub messages: Vec<SyncRecord>,
    pub reading_sessions: Vec<SyncRecord>,
    pub skills: Vec<SyncRecord>,
    pub tombstones: Vec<Tombstone>,
}

/// A single record to sync (any table row serialized as JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRecord {
    pub id: String,
    pub data: serde_json::Value,
    pub updated_at: i64,
    pub sync_version: i64,
    pub last_modified_by: String,
}

/// A deletion record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tombstone {
    pub id: String,
    pub table_name: String,
    pub deleted_at: i64,
    pub device_id: String,
}

/// Result of a sync operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub records_uploaded: u32,
    pub records_downloaded: u32,
    pub records_merged: u32,
    pub conflicts_count: u32,
    pub files_uploaded: u32,
    pub files_downloaded: u32,
    pub duration_ms: u64,
    pub error: Option<String>,
}

impl Default for SyncResult {
    fn default() -> Self {
        Self {
            success: true,
            records_uploaded: 0,
            records_downloaded: 0,
            records_merged: 0,
            conflicts_count: 0,
            files_uploaded: 0,
            files_downloaded: 0,
            duration_ms: 0,
            error: None,
        }
    }
}

/// Current sync status (for UI display)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_configured: bool,
    pub is_syncing: bool,
    pub last_sync_at: Option<i64>,
    pub last_result: Option<SyncResult>,
    pub device_id: Option<String>,
    pub phase: Option<String>,
    pub progress: Option<SyncProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub current_file: Option<String>,
}

/// A detected conflict between local and remote data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConflict {
    pub id: String,
    pub table_name: String,
    pub record_id: String,
    pub local_data: serde_json::Value,
    pub remote_data: serde_json::Value,
    pub local_updated_at: i64,
    pub remote_updated_at: i64,
    pub conflict_type: ConflictType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    BothModified,
    LocalDeletedRemoteModified,
    LocalModifiedRemoteDeleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictResolution {
    KeepLocal,
    KeepRemote,
    KeepBoth,
}

/// Tables that participate in sync
pub const SYNCED_TABLES: &[&str] = &[
    "books",
    "highlights",
    "notes",
    "bookmarks",
    "threads",
    "messages",
    "reading_sessions",
    "skills",
];
