use thiserror::Error;

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("WebDAV connection failed: {0}")]
    ConnectionFailed(String),

    #[error("WebDAV authentication failed")]
    AuthFailed,

    #[error("WebDAV server error: {status} {message}")]
    ServerError { status: u16, message: String },

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("XML parse error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Sync already in progress")]
    AlreadySyncing,

    #[error("Sync not configured")]
    NotConfigured,

    #[error("Schema version mismatch: remote={remote}, local={local}")]
    SchemaVersionMismatch { remote: i32, local: i32 },

    #[error("File hash error: {0}")]
    HashError(String),

    #[error("{0}")]
    Other(String),
}

impl From<SyncError> for String {
    fn from(e: SyncError) -> String {
        e.to_string()
    }
}

impl serde::Serialize for SyncError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
