use std::path::Path;

use super::error::SyncError;
use super::webdav::WebDavClient;

const REMOTE_SETTINGS: &str = "/readany/settings/shared/settings.json";

/// Sync settings (read settings, translation config, tags)
pub async fn sync_settings(
    client: &WebDavClient,
    app_data_dir: &str,
) -> Result<(), SyncError> {
    // Ensure remote settings directory exists
    client.ensure_directory("/readany/settings/shared").await?;

    let store_dir = Path::new(app_data_dir).join("readany-store");

    // Read local settings
    let local_settings_path = store_dir.join("settings.json");
    let local_settings = if local_settings_path.exists() {
        tokio::fs::read_to_string(&local_settings_path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
        None
    };

    // Read remote settings
    let remote_settings: Option<serde_json::Value> =
        client.get_json_optional(REMOTE_SETTINGS).await?;

    match (local_settings, remote_settings) {
        (Some(local), Some(remote)) => {
            // Both exist — merge by timestamp
            let local_ts = local
                .get("state")
                .and_then(|s| s.get("settingsUpdatedAt"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let remote_ts = remote
                .get("state")
                .and_then(|s| s.get("settingsUpdatedAt"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if remote_ts > local_ts {
                // Remote is newer — apply remote settings locally
                // Only sync safe settings (readSettings, translationConfig), NOT aiConfig
                if let Some(remote_state) = remote.get("state") {
                    let mut local_val = local.clone();
                    if let Some(local_state) = local_val.get_mut("state") {
                        // Merge readSettings from remote
                        if let Some(rs) = remote_state.get("readSettings") {
                            local_state
                                .as_object_mut()
                                .map(|m| m.insert("readSettings".into(), rs.clone()));
                        }
                        // Merge translationConfig from remote
                        if let Some(tc) = remote_state.get("translationConfig") {
                            local_state
                                .as_object_mut()
                                .map(|m| m.insert("translationConfig".into(), tc.clone()));
                        }
                        // Update timestamp
                        local_state
                            .as_object_mut()
                            .map(|m| m.insert("settingsUpdatedAt".into(), serde_json::json!(remote_ts)));
                    }
                    // Write merged settings locally
                    let merged_json = serde_json::to_string_pretty(&local_val)?;
                    tokio::fs::write(&local_settings_path, merged_json).await?;
                }
            } else if local_ts > remote_ts {
                // Local is newer — upload to remote
                upload_safe_settings(client, &local).await?;
            }
        }
        (Some(local), None) => {
            // Only local exists — upload
            upload_safe_settings(client, &local).await?;
        }
        (None, Some(remote)) => {
            // Only remote exists — download and apply
            let settings_json = serde_json::to_string_pretty(&remote)?;
            tokio::fs::create_dir_all(&store_dir).await?;
            tokio::fs::write(&local_settings_path, settings_json).await?;
        }
        (None, None) => {
            // Neither exists — nothing to sync
        }
    }

    // Sync tags
    sync_tags(client, &store_dir).await?;

    Ok(())
}

/// Upload only safe (non-sensitive) settings to remote
async fn upload_safe_settings(
    client: &WebDavClient,
    settings: &serde_json::Value,
) -> Result<(), SyncError> {
    // Extract only safe settings to upload (exclude aiConfig which has API keys)
    let mut safe_settings = settings.clone();
    if let Some(state) = safe_settings.get_mut("state") {
        if let Some(obj) = state.as_object_mut() {
            obj.remove("aiConfig");
        }
    }
    client.put_json(REMOTE_SETTINGS, &safe_settings).await
}

/// Sync library tags (union merge)
async fn sync_tags(client: &WebDavClient, store_dir: &Path) -> Result<(), SyncError> {
    let tags_path = store_dir.join("library-tags.json");
    let remote_tags_path = "/readany/settings/shared/library-tags.json";

    let local_tags: Vec<String> = if tags_path.exists() {
        tokio::fs::read_to_string(&tags_path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        vec![]
    };

    let remote_tags: Vec<String> = client
        .get_json_optional(remote_tags_path)
        .await?
        .unwrap_or_default();

    // Union merge
    let mut merged: Vec<String> = local_tags.clone();
    for tag in &remote_tags {
        if !merged.contains(tag) {
            merged.push(tag.clone());
        }
    }
    merged.sort();

    // Write back if changed
    if merged != local_tags {
        let json = serde_json::to_string_pretty(&merged)?;
        tokio::fs::write(&tags_path, json).await?;
    }
    if merged != remote_tags {
        client.put_json(remote_tags_path, &merged).await?;
    }

    Ok(())
}
