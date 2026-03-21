use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri::Manager;

/// Get the path to the app's database file
fn db_path(app: &AppHandle) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_dir.join("readany.db").to_string_lossy().to_string())
}

/// Create a snapshot of the database via VACUUM INTO.
/// This creates a clean, defragmented copy without locking the main DB.
#[tauri::command]
pub async fn sync_vacuum_into(app: AppHandle, target_path: String) -> Result<(), String> {
    let source = db_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&source).map_err(|e| format!("Failed to open DB: {}", e))?;
        conn.execute_batch(&format!("VACUUM INTO '{}'", target_path))
            .map_err(|e| format!("VACUUM INTO failed: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Check the integrity of a database file.
/// Returns true if the database passes PRAGMA integrity_check.
#[tauri::command]
pub async fn sync_integrity_check(db_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
        let result: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| format!("integrity_check failed: {}", e))?;
        Ok::<bool, String>(result == "ok")
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Compute SHA-256 hash of a file, returns hex string.
#[tauri::command]
pub async fn sync_hash_file(path: String) -> Result<String, String> {
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
    let hash = Sha256::digest(&data);
    Ok(format!("{:x}", hash))
}

/// Get the local IP address of this machine.
/// Uses the local-ip-address crate which safely queries network interfaces.
#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    match local_ip_address::local_ip() {
        Ok(ip) => Ok(ip.to_string()),
        Err(e) => Err(format!("Failed to get local IP: {}", e)),
    }
}
