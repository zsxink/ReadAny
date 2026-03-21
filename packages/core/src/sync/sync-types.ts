/**
 * Cloud sync types — whole-database overwrite sync via WebDAV
 */

/** WebDAV configuration (password stored separately in secure KV under key "sync_password") */
export interface SyncConfig {
  url: string;
  username: string;
  autoSync: boolean;
  syncIntervalMins: number;
  wifiOnly: boolean;
  notifyOnComplete: boolean;
}

export const DEFAULT_SYNC_CONFIG: Partial<SyncConfig> = {
  autoSync: false,
  syncIntervalMins: 30,
  wifiOnly: false,
  notifyOnComplete: true,
};

/** Sync direction determined by comparing local vs remote DB state */
export type SyncDirection = "upload" | "download" | "conflict" | "none";

/** Runtime status of the sync engine */
export type SyncStatusType =
  | "idle"
  | "checking"
  | "uploading"
  | "downloading"
  | "syncing-files"
  | "error";

/** Result of a completed sync operation */
export interface SyncResult {
  success: boolean;
  direction: SyncDirection;
  filesUploaded: number;
  filesDownloaded: number;
  durationMs: number;
  error?: string;
}

/** Manifest stored alongside the DB on WebDAV */
export interface RemoteSyncManifest {
  lastModifiedAt: number;
  uploadedBy: string;
  appVersion: string;
  schemaVersion: number;
}

/** WebDAV resource from PROPFIND */
export interface DavResource {
  href: string;
  name: string;
  isCollection: boolean;
  contentLength?: number;
  lastModified?: string;
  etag?: string;
}

/** Detailed progress information for sync operations */
export interface SyncProgress {
  phase: "database" | "files";
  operation: "upload" | "download";
  currentFile?: string;
  completedFiles: number;
  totalFiles: number;
  message: string;
}

/** Progress callback for upload/download */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/** Remote directory structure constants */
export const REMOTE_ROOT = "/readany";
export const REMOTE_DATA = "/readany/data";
export const REMOTE_DB_FILE = "/readany/data/readany.db";
export const REMOTE_MANIFEST = "/readany/data/manifest.json";
export const REMOTE_FILES = "/readany/data/file";
export const REMOTE_COVERS = "/readany/data/cover";

/** Sync metadata keys stored in sync_metadata table */
export const SYNC_META_KEYS = {
  LAST_SYNC_AT: "last_sync_at",
  LAST_SYNC_DB_HASH: "last_sync_db_hash",
  LAST_REMOTE_MODIFIED_AT: "last_remote_modified_at",
  DEVICE_ID: "device_id",
} as const;

/** Current schema version for sync compatibility */
export const SYNC_SCHEMA_VERSION = 1;
