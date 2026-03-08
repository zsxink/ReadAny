use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

use super::engine;
use super::file_sync;
use super::models::*;
use super::webdav::WebDavClient;

/// Get the database path for the app
fn db_path(app: &AppHandle) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_dir
        .join("readany.db")
        .to_str()
        .unwrap_or("")
        .to_string())
}

/// Get app data directory
fn app_data_dir(app: &AppHandle) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_dir.to_str().unwrap_or("").to_string())
}

/// Test WebDAV connection
#[tauri::command]
pub async fn sync_test_connection(
    url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    let client = WebDavClient::new(&url, &username, &password).map_err(|e| e.to_string())?;
    client.test_connection().await.map_err(|e| e.to_string())
}

/// Save WebDAV configuration
#[tauri::command]
pub async fn sync_configure(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let config = SyncConfig {
        url,
        username,
        password,
        auto_sync: false,
        sync_interval_mins: 30,
    };
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    engine::set_sync_meta(&conn, "sync_config", &config_json).map_err(|e| e.to_string())?;

    Ok(())
}

/// Get current sync configuration
#[tauri::command]
pub async fn sync_get_config(app: AppHandle) -> Result<Option<SyncConfig>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    match engine::get_sync_meta(&conn, "sync_config") {
        Some(json) => {
            let config: SyncConfig =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

/// Execute a full sync
#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<SyncResult, String> {
    let path = db_path(&app)?;
    let data_dir = app_data_dir(&app)?;

    // Read config and device info synchronously, then drop connection
    let (config, device_id, device_name) = {
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        let config_json = engine::get_sync_meta(&conn, "sync_config")
            .ok_or_else(|| "Sync not configured".to_string())?;
        let config: SyncConfig =
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?;
        let device_id =
            engine::get_or_create_device_id(&conn).map_err(|e| e.to_string())?;
        let device_name = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Unknown".to_string());
        (config, device_id, device_name)
    }; // conn dropped here

    // Create WebDAV client and run sync (all async, engine manages its own connections)
    let client = WebDavClient::new(&config.url, &config.username, &config.password)
        .map_err(|e| e.to_string())?;

    let result = engine::run_sync(client, path.clone(), data_dir.clone(), device_id.clone(), device_name)
        .await
        .map_err(|e| e.to_string())?;

    // Sync settings with a fresh client
    let settings_client = WebDavClient::new(&config.url, &config.username, &config.password)
        .map_err(|e| e.to_string())?;
    if let Err(e) = super::settings_sync::sync_settings(&settings_client, &data_dir).await {
        eprintln!("Warning: Settings sync failed: {}", e);
    }

    // Store last result
    {
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        if let Ok(result_json) = serde_json::to_string(&result) {
            let _ = engine::set_sync_meta(&conn, "last_sync_result", &result_json);
        }
    }

    // Notify frontend
    let _ = app.emit("sync:complete", &result);

    Ok(result)
}

/// Get current sync status
#[tauri::command]
pub async fn sync_get_status(app: AppHandle) -> Result<SyncStatus, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let is_configured = engine::get_sync_meta(&conn, "sync_config").is_some();
    let last_sync_at = engine::get_sync_meta(&conn, "last_sync_at")
        .and_then(|s| s.parse::<i64>().ok());
    let device_id = engine::get_sync_meta(&conn, "device_id");
    let last_result = engine::get_sync_meta(&conn, "last_sync_result")
        .and_then(|s| serde_json::from_str::<SyncResult>(&s).ok());

    Ok(SyncStatus {
        is_configured,
        is_syncing: false,
        last_sync_at,
        last_result,
        device_id,
        phase: None,
        progress: None,
    })
}

/// Compute SHA-256 hash of a file
#[tauri::command]
pub async fn sync_hash_file(path: String) -> Result<String, String> {
    file_sync::compute_file_hash(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Enable or disable auto-sync
#[tauri::command]
pub async fn sync_set_auto_sync(app: AppHandle, enabled: bool) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    if let Some(config_json) = engine::get_sync_meta(&conn, "sync_config") {
        let mut config: SyncConfig =
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?;
        config.auto_sync = enabled;
        let updated = serde_json::to_string(&config).map_err(|e| e.to_string())?;
        engine::set_sync_meta(&conn, "sync_config", &updated).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Reset all sync metadata (for troubleshooting)
#[tauri::command]
pub async fn sync_reset(app: AppHandle) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM sync_metadata WHERE key != 'device_id'", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_tombstones", [])
        .map_err(|e| e.to_string())?;
    for table in SYNCED_TABLES {
        conn.execute(
            &format!(
                "UPDATE {} SET sync_version = 0, last_modified_by = NULL",
                table
            ),
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
