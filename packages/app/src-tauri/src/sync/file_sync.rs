use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use super::error::SyncError;
use super::webdav::{filename_from_href, WebDavClient};

/// Remote path constants
const REMOTE_FILES_BOOKS: &str = "/readany/files/books";
const REMOTE_FILES_COVERS: &str = "/readany/files/covers";

/// Result of file sync operations
pub struct FileSyncResult {
    pub files_uploaded: u32,
    pub files_downloaded: u32,
    /// DB updates to apply after async operations
    pub db_updates: Vec<DbUpdate>,
}

/// A pending DB update from file sync
pub enum DbUpdate {
    SetFilePath { book_id: String, path: String },
    SetFileHash { book_id: String, hash: String },
}

/// Info about a book's files needed for sync
struct BookFileInfo {
    id: String,
    file_path: String,
    file_hash: Option<String>,
    format: String,
}

/// Info about a cover needed for sync
struct CoverInfo {
    book_id: String,
    local_path: Option<PathBuf>,
    extension: String,
}

pub struct FileSyncEngine<'a> {
    client: &'a WebDavClient,
    app_data_dir: String,
}

impl<'a> FileSyncEngine<'a> {
    pub fn new(client: &'a WebDavClient, app_data_dir: &str) -> Self {
        Self {
            client,
            app_data_dir: app_data_dir.to_string(),
        }
    }

    /// Sync book files and cover images.
    /// Collects DB data synchronously, then does async WebDAV operations,
    /// then returns DB updates to be applied by the caller.
    pub async fn sync_files(&self, db_path: &str) -> Result<FileSyncResult, SyncError> {
        let mut result = FileSyncResult {
            files_uploaded: 0,
            files_downloaded: 0,
            db_updates: Vec::new(),
        };

        // Collect all DB data synchronously
        let (covers, books) = {
            let conn = Connection::open(db_path)?;
            let covers = collect_cover_info(&conn, &self.app_data_dir)?;
            let books = collect_book_info(&conn)?;
            (covers, books)
        }; // conn dropped here

        // Async WebDAV operations for covers
        let cover_result = self.sync_covers_async(&covers).await?;
        result.files_uploaded += cover_result.files_uploaded;
        result.files_downloaded += cover_result.files_downloaded;

        // Async WebDAV operations for books
        let book_result = self.sync_book_files_async(&books).await?;
        result.files_uploaded += book_result.files_uploaded;
        result.files_downloaded += book_result.files_downloaded;
        result.db_updates.extend(book_result.db_updates);

        // Apply DB updates synchronously
        if !result.db_updates.is_empty() {
            let conn = Connection::open(db_path)?;
            for update in &result.db_updates {
                match update {
                    DbUpdate::SetFilePath { book_id, path } => {
                        let _ = conn.execute(
                            "UPDATE books SET file_path = ?1 WHERE id = ?2",
                            rusqlite::params![path, book_id],
                        );
                    }
                    DbUpdate::SetFileHash { book_id, hash } => {
                        let _ = conn.execute(
                            "UPDATE books SET file_hash = ?1 WHERE id = ?2",
                            rusqlite::params![hash, book_id],
                        );
                    }
                }
            }
        }

        Ok(result)
    }

    async fn sync_covers_async(&self, covers: &[CoverInfo]) -> Result<FileSyncResult, SyncError> {
        let mut result = FileSyncResult {
            files_uploaded: 0,
            files_downloaded: 0,
            db_updates: Vec::new(),
        };

        let remote_covers = self.client.propfind(REMOTE_FILES_COVERS).await?;
        let remote_names: Vec<String> = remote_covers
            .iter()
            .filter(|r| !r.is_collection)
            .map(|r| filename_from_href(&r.href))
            .collect();

        let covers_dir = Path::new(&self.app_data_dir).join("covers");

        for cover in covers {
            let remote_name = format!("{}.{}", cover.book_id, cover.extension);

            if let Some(local_path) = &cover.local_path {
                if !remote_names.contains(&remote_name) {
                    let remote_path = format!("{}/{}", REMOTE_FILES_COVERS, remote_name);
                    if let Ok(()) = self
                        .client
                        .upload_file(local_path.to_str().unwrap_or(""), &remote_path)
                        .await
                    {
                        result.files_uploaded += 1;
                    }
                }
            } else {
                for rn in &remote_names {
                    if rn.starts_with(&cover.book_id) {
                        let remote_path = format!("{}/{}", REMOTE_FILES_COVERS, rn);
                        let local_path = covers_dir.join(rn);
                        if let Ok(()) = self
                            .client
                            .download_file(&remote_path, local_path.to_str().unwrap_or(""))
                            .await
                        {
                            result.files_downloaded += 1;
                        }
                        break;
                    }
                }
            }
        }

        Ok(result)
    }

    async fn sync_book_files_async(
        &self,
        books: &[BookFileInfo],
    ) -> Result<FileSyncResult, SyncError> {
        let mut result = FileSyncResult {
            files_uploaded: 0,
            files_downloaded: 0,
            db_updates: Vec::new(),
        };

        let remote_books = self.client.propfind(REMOTE_FILES_BOOKS).await?;
        let remote_names: Vec<String> = remote_books
            .iter()
            .filter(|r| !r.is_collection)
            .map(|r| filename_from_href(&r.href))
            .collect();

        for book in books {
            let local_exists = Path::new(&book.file_path).exists();

            if let Some(hash) = &book.file_hash {
                let remote_name = format!("{}.{}", hash, book.format);

                if local_exists && !remote_names.contains(&remote_name) {
                    let remote_path = format!("{}/{}", REMOTE_FILES_BOOKS, remote_name);
                    match self.client.upload_file(&book.file_path, &remote_path).await {
                        Ok(()) => result.files_uploaded += 1,
                        Err(e) => eprintln!("Warning: Failed to upload book {}: {}", book.id, e),
                    }
                } else if !local_exists && remote_names.contains(&remote_name) {
                    let remote_path = format!("{}/{}", REMOTE_FILES_BOOKS, remote_name);
                    let books_dir = Path::new(&self.app_data_dir).join("books");
                    let local_dest = books_dir.join(&remote_name);
                    match self
                        .client
                        .download_file(&remote_path, local_dest.to_str().unwrap_or(""))
                        .await
                    {
                        Ok(()) => {
                            result.db_updates.push(DbUpdate::SetFilePath {
                                book_id: book.id.clone(),
                                path: local_dest.to_str().unwrap_or("").to_string(),
                            });
                            result.files_downloaded += 1;
                        }
                        Err(e) => {
                            eprintln!("Warning: Failed to download book {}: {}", book.id, e)
                        }
                    }
                }
            } else if local_exists {
                match compute_file_hash(&book.file_path).await {
                    Ok(hash) => {
                        result.db_updates.push(DbUpdate::SetFileHash {
                            book_id: book.id.clone(),
                            hash: hash.clone(),
                        });
                        let remote_name = format!("{}.{}", hash, book.format);
                        if !remote_names.contains(&remote_name) {
                            let remote_path = format!("{}/{}", REMOTE_FILES_BOOKS, remote_name);
                            match self.client.upload_file(&book.file_path, &remote_path).await {
                                Ok(()) => result.files_uploaded += 1,
                                Err(e) => eprintln!(
                                    "Warning: Failed to upload book {}: {}",
                                    book.id, e
                                ),
                            }
                        }
                    }
                    Err(e) => eprintln!("Warning: Failed to hash book {}: {}", book.id, e),
                }
            }
        }

        Ok(result)
    }
}

fn collect_cover_info(conn: &Connection, app_data_dir: &str) -> Result<Vec<CoverInfo>, SyncError> {
    let covers_dir = Path::new(app_data_dir).join("covers");
    let mut stmt = conn.prepare(
        "SELECT id FROM books WHERE cover_url IS NOT NULL AND cover_url != ''",
    )?;
    let mut rows = stmt.query([])?;
    let mut covers = Vec::new();

    while let Some(row) = rows.next()? {
        let book_id: String = row.get(0)?;
        let local_path = find_cover_file(&covers_dir, &book_id);
        let extension = local_path
            .as_ref()
            .and_then(|p| p.extension())
            .and_then(|e| e.to_str())
            .unwrap_or("jpg")
            .to_string();
        covers.push(CoverInfo {
            book_id,
            local_path,
            extension,
        });
    }

    Ok(covers)
}

fn collect_book_info(conn: &Connection) -> Result<Vec<BookFileInfo>, SyncError> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, file_hash, format FROM books WHERE file_path IS NOT NULL AND file_path != ''",
    )?;
    let mut rows = stmt.query([])?;
    let mut books = Vec::new();

    while let Some(row) = rows.next()? {
        books.push(BookFileInfo {
            id: row.get(0)?,
            file_path: row.get(1)?,
            file_hash: row.get(2)?,
            format: row.get(3)?,
        });
    }

    Ok(books)
}

/// Compute SHA-256 hash of a file
pub async fn compute_file_hash(path: &str) -> Result<String, SyncError> {
    let data = tokio::fs::read(path)
        .await
        .map_err(|e| SyncError::HashError(format!("Failed to read file {}: {}", path, e)))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

fn find_cover_file(covers_dir: &Path, book_id: &str) -> Option<PathBuf> {
    if !covers_dir.exists() {
        return None;
    }
    for ext in &["jpg", "jpeg", "png", "webp"] {
        let path = covers_dir.join(format!("{}.{}", book_id, ext));
        if path.exists() {
            return Some(path);
        }
    }
    None
}
