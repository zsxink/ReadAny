use base64::Engine;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::error::SyncError;

/// A resource returned from WebDAV PROPFIND
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DavResource {
    pub href: String,
    pub is_collection: bool,
    pub content_length: Option<u64>,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
}

/// WebDAV client using reqwest
pub struct WebDavClient {
    client: Client,
    base_url: String,
    auth_header: String,
}

impl WebDavClient {
    pub fn new(base_url: &str, username: &str, password: &str) -> Result<Self, SyncError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(SyncError::Network)?;

        let credentials = format!("{}:{}", username, password);
        let auth_header = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(credentials)
        );

        // Ensure base_url ends with /
        let base_url = if base_url.ends_with('/') {
            base_url.to_string()
        } else {
            format!("{}/", base_url)
        };

        Ok(Self {
            client,
            base_url,
            auth_header,
        })
    }

    /// Build the full URL for a given path
    fn url(&self, path: &str) -> String {
        let path = path.trim_start_matches('/');
        // Percent-encode each path segment but preserve /
        let encoded: String = path
            .split('/')
            .map(|segment| utf8_percent_encode(segment, NON_ALPHANUMERIC).to_string())
            .collect::<Vec<_>>()
            .join("/");
        format!("{}{}", self.base_url, encoded)
    }

    /// Test connection by sending PROPFIND to the base URL
    pub async fn test_connection(&self) -> Result<bool, SyncError> {
        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .header("Authorization", &self.auth_header)
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(r#"<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>"#)
            .send()
            .await
            .map_err(|e| SyncError::ConnectionFailed(e.to_string()))?;

        match response.status().as_u16() {
            207 => Ok(true),
            401 | 403 => Err(SyncError::AuthFailed),
            status => Err(SyncError::ServerError {
                status,
                message: format!("Unexpected status from PROPFIND: {}", status),
            }),
        }
    }

    /// Create a collection (directory) at the given path
    pub async fn mkcol(&self, path: &str) -> Result<(), SyncError> {
        let url = self.url(path);
        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(SyncError::Network)?;

        match response.status().as_u16() {
            201 | 405 => Ok(()), // 405 = already exists, that's fine
            status => Err(SyncError::ServerError {
                status,
                message: format!("MKCOL {} failed", path),
            }),
        }
    }

    /// Ensure a directory path exists, creating parent directories as needed
    pub async fn ensure_directory(&self, path: &str) -> Result<(), SyncError> {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        let mut current = String::new();
        for part in parts {
            if !part.is_empty() {
                current = format!("{}/{}", current, part);
                self.mkcol(&current).await?;
            }
        }
        Ok(())
    }

    /// Upload data to a path
    pub async fn put(&self, path: &str, data: Vec<u8>, content_type: &str) -> Result<(), SyncError> {
        let url = self.url(path);
        let response = self
            .client
            .put(&url)
            .header("Authorization", &self.auth_header)
            .header("Content-Type", content_type)
            .body(data)
            .send()
            .await
            .map_err(SyncError::Network)?;

        let status = response.status().as_u16();
        if status == 201 || status == 204 || status == 200 {
            Ok(())
        } else {
            Err(SyncError::ServerError {
                status,
                message: format!("PUT {} failed", path),
            })
        }
    }

    /// Upload a JSON-serializable object
    pub async fn put_json<T: Serialize>(&self, path: &str, data: &T) -> Result<(), SyncError> {
        let json = serde_json::to_vec(data)?;
        self.put(path, json, "application/json").await
    }

    /// Download data from a path
    pub async fn get(&self, path: &str) -> Result<Vec<u8>, SyncError> {
        let url = self.url(path);
        let response = self
            .client
            .get(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(SyncError::Network)?;

        let status = response.status().as_u16();
        if status == 200 {
            Ok(response.bytes().await.map_err(SyncError::Network)?.to_vec())
        } else if status == 404 {
            Err(SyncError::ServerError {
                status: 404,
                message: format!("Not found: {}", path),
            })
        } else {
            Err(SyncError::ServerError {
                status,
                message: format!("GET {} failed", path),
            })
        }
    }

    /// Download and deserialize a JSON object
    pub async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, SyncError> {
        let data = self.get(path).await?;
        Ok(serde_json::from_slice(&data)?)
    }

    /// Try to download a JSON object, return None if 404
    pub async fn get_json_optional<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
    ) -> Result<Option<T>, SyncError> {
        match self.get_json(path).await {
            Ok(data) => Ok(Some(data)),
            Err(SyncError::ServerError { status: 404, .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Delete a resource
    #[allow(dead_code)]
    pub async fn delete(&self, path: &str) -> Result<(), SyncError> {
        let url = self.url(path);
        let response = self
            .client
            .delete(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(SyncError::Network)?;

        let status = response.status().as_u16();
        if status == 204 || status == 200 || status == 404 {
            Ok(()) // 404 is fine — already deleted
        } else {
            Err(SyncError::ServerError {
                status,
                message: format!("DELETE {} failed", path),
            })
        }
    }

    /// Check if a resource exists
    #[allow(dead_code)]
    pub async fn exists(&self, path: &str) -> Result<bool, SyncError> {
        let url = self.url(path);
        let response = self
            .client
            .request(reqwest::Method::HEAD, &url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(SyncError::Network)?;

        Ok(response.status().is_success())
    }

    /// List resources in a collection via PROPFIND
    pub async fn propfind(&self, path: &str) -> Result<Vec<DavResource>, SyncError> {
        let url = self.url(path);
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getetag/>
  </D:prop>
</D:propfind>"#;

        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header("Authorization", &self.auth_header)
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(body)
            .send()
            .await
            .map_err(SyncError::Network)?;

        let status = response.status().as_u16();
        if status == 404 {
            return Ok(vec![]);
        }
        if status != 207 {
            return Err(SyncError::ServerError {
                status,
                message: format!("PROPFIND {} failed", path),
            });
        }

        let xml_body = response.text().await.map_err(SyncError::Network)?;
        parse_propfind_response(&xml_body, path)
    }

    /// Upload a file from the filesystem (streaming)
    pub async fn upload_file(&self, local_path: &str, remote_path: &str) -> Result<(), SyncError> {
        let data = tokio::fs::read(local_path).await?;
        self.put(remote_path, data, "application/octet-stream").await
    }

    /// Download a file to the filesystem
    pub async fn download_file(
        &self,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), SyncError> {
        let data = self.get(remote_path).await?;
        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(local_path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(local_path, data).await?;
        Ok(())
    }
}

/// Parse a PROPFIND multistatus XML response
fn parse_propfind_response(xml: &str, base_path: &str) -> Result<Vec<DavResource>, SyncError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut resources: Vec<DavResource> = Vec::new();
    let mut current_href: Option<String> = None;
    let mut current_is_collection = false;
    let mut current_content_length: Option<u64> = None;
    let mut current_last_modified: Option<String> = None;
    let mut current_etag: Option<String> = None;
    let mut in_response = false;
    let mut current_tag = String::new();

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let local_name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                match local_name.as_str() {
                    "response" => {
                        in_response = true;
                        current_href = None;
                        current_is_collection = false;
                        current_content_length = None;
                        current_last_modified = None;
                        current_etag = None;
                    }
                    "collection" if in_response => {
                        current_is_collection = true;
                    }
                    _ => {}
                }
                current_tag = local_name;
            }
            Ok(Event::Text(ref e)) if in_response => {
                let text = e.unescape().unwrap_or_default().to_string();
                match current_tag.as_str() {
                    "href" => {
                        current_href = Some(text);
                    }
                    "getcontentlength" => {
                        current_content_length = text.parse().ok();
                    }
                    "getlastmodified" => {
                        current_last_modified = Some(text);
                    }
                    "getetag" => {
                        current_etag = Some(text.trim_matches('"').to_string());
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if local_name == "response" {
                    in_response = false;
                    if let Some(href) = current_href.take() {
                        resources.push(DavResource {
                            href,
                            is_collection: current_is_collection,
                            content_length: current_content_length,
                            last_modified: current_last_modified.take(),
                            etag: current_etag.take(),
                        });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(SyncError::Xml(e)),
            _ => {}
        }
        buf.clear();
    }

    // Filter out the parent directory itself (first result is usually the queried path)
    let base_normalized = base_path.trim_matches('/');
    resources.retain(|r| {
        let href_normalized = r.href.trim_matches('/');
        // Decode percent-encoded href for comparison
        let decoded = percent_encoding::percent_decode_str(href_normalized)
            .decode_utf8_lossy()
            .to_string();
        let decoded_normalized = decoded.trim_matches('/');
        // Keep if href doesn't end with the base path (i.e., it's a child)
        !decoded_normalized.ends_with(base_normalized) || decoded_normalized != base_normalized
            && !href_normalized.ends_with(base_normalized)
    });

    Ok(resources)
}

/// Extract filename from a WebDAV href
pub fn filename_from_href(href: &str) -> String {
    let decoded = percent_encoding::percent_decode_str(href)
        .decode_utf8_lossy()
        .to_string();
    decoded
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}
